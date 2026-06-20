import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from 'bullmq';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { config as loadDotenv } from 'dotenv';
import { createDocumentsRepo, createJobsRepo, createSandboxRunsRepo, createSettingsRepo, getDb, loadRuntimeConfig } from '@wf/db';
import { MAIN_QUEUE_NAME, createGraphQueue, createWorker, defaultJobOptions } from '@wf/queue';
import { DockerSandboxRunner } from '@wf/sandbox';
import { loadEnv, type DocumentDTO, type EmbedFn, type RuntimeConfig } from '@wf/shared';
import { createTripletExtractionModels, runGraphPipeline } from '@wf/graph-worker/pipeline';
import { runMainPipeline } from './pipeline.js';

export { runMainPipeline, extractCandidateResult, extractMergeResult } from './pipeline.js';

loadDotenv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
const env = loadEnv();
const SANDBOX_IMAGE = 'wekiflow/sandbox:latest';
const PREVIEW_MAX_TRIPLET_CHUNKS = 24;

const db = await getDb();
const docs = createDocumentsRepo(db);
const jobs = createJobsRepo(db);
const sandboxRuns = createSandboxRunsRepo(db);
const settings = createSettingsRepo(db);
const graphQueue = createGraphQueue();

const tripletModels = createTripletExtractionModels(env);

type MainJob = Job<{ documentId: string; commit?: boolean }>;

async function loadJobRuntime(): Promise<{
  effective: RuntimeConfig;
  model: ReturnType<typeof openai>;
  embed: EmbedFn;
}> {
  const { effective } = await loadRuntimeConfig(db);
  const model = openai(effective.models?.agentModel ?? env.AGENT_MODEL);
  const embeddingModel = openai.textEmbeddingModel(effective.models?.embeddingModel ?? env.EMBEDDING_MODEL);
  const embed: EmbedFn = async (texts) => (await embedMany({ model: embeddingModel, values: texts })).embeddings;
  return { effective, model, embed };
}

/** Sync the document into a per-job temp dir mounted read-only at /docs. */
async function writeDocSnapshot(snapshotDir: string, doc: DocumentDTO): Promise<void> {
  const fileName = `${(doc.slug || 'document').replace(/[^\p{L}\p{N}-]+/gu, '-')}.md`;
  await writeFile(path.join(snapshotDir, fileName), doc.contentMarkdown, 'utf8');
}

function createSandbox(jobId: string): DockerSandboxRunner {
  return new DockerSandboxRunner({
    image: SANDBOX_IMAGE,
    audit: (entry) => sandboxRuns.record({ jobId, ...entry }),
  });
}

function progressOnStep(job: MainJob) {
  return (step: unknown) => {
    const calls = (step as { toolCalls?: Array<{ toolName: string }> }).toolCalls ?? [];
    return job.updateProgress({ type: 'step', tools: calls.map((c) => c.toolName) });
  };
}

/** Normal ingest: run the agent, then either hold for REVIEW or auto-publish based on settings. */
async function runIngestJob(job: MainJob, doc: DocumentDTO, jobId: string, documentId: string) {
  await job.updateProgress(5);
  const runtime = await loadJobRuntime();
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    await writeDocSnapshot(snapshotDir, doc);
    const result = await runMainPipeline(documentId, {
      db,
      sandbox: createSandbox(jobId),
      docsSnapshotDir: snapshotDir,
      jobId,
      embed: runtime.embed,
      model: runtime.model,
      embeddingModel: runtime.effective.models?.embeddingModel ?? env.EMBEDDING_MODEL,
      prompts: runtime.effective.prompts,
      agentParams: runtime.effective.agentParams,
      onStep: progressOnStep(job),
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'main' }),
    });
    if (!result.merged) {
      console.warn(
        `[main-worker] job ${jobId}: agent produced no merge for ${documentId}; using original content.`,
      );
    }
    if (result.status === 'SKIPPED' || result.status === 'SOURCE_ONLY') {
      await job.updateProgress(100);
      return { documentId: result.documentId, status: result.status, merged: result.merged };
    }
    if (!(await settings.get()).reviewApprovalEnabled) {
      const published = await docs.publish(documentId);
      if (!published) throw new Error(`Document not found while skipping review: ${documentId}`);
      await graphQueue.add('EXTRACT_TRIPLETS', { documentId }, defaultJobOptions());
      await job.updateProgress(100);
      return { documentId: published.id, status: published.status, merged: result.merged, reviewSkipped: true };
    }
    await job.updateProgress(100);
    return { documentId: result.documentId, status: result.status, merged: result.merged };
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * Ephemeral preview: run the agent + triplet extraction without persisting graph rows, then drop the
 * draft document. The result is persisted on the jobs record so the run survives the draft deletion
 * and BullMQ eviction. Enqueued with attempts:1, so artifacts are always cleaned up here.
 */
async function runPreviewJob(job: MainJob, doc: DocumentDTO, jobId: string, documentId: string) {
  const attempts = job.attemptsMade + 1;
  const lifecycle = { queue: MAIN_QUEUE_NAME, type: 'PREVIEW' as const, documentId, title: doc.title };
  await jobs.recordLifecycle(jobId, { ...lifecycle, status: 'active', attempts });
  await job.updateProgress(5);
  const runtime = await loadJobRuntime();
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    await writeDocSnapshot(snapshotDir, doc);
    const result = await runMainPipeline(documentId, {
      db,
      sandbox: createSandbox(jobId),
      docsSnapshotDir: snapshotDir,
      jobId,
      embed: runtime.embed,
      model: runtime.model,
      embeddingModel: runtime.effective.models?.embeddingModel ?? env.EMBEDDING_MODEL,
      prompts: runtime.effective.prompts,
      agentParams: runtime.effective.agentParams,
      preview: true,
      onStep: progressOnStep(job),
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'main' }),
    });

    await job.updateProgress({ type: 'phase', phase: 'graph', progress: 70 });
    const graphResult = await runGraphPipeline(documentId, {
      db,
      models: tripletModels.length > 0 ? tripletModels : [{ label: `openai:${runtime.effective.models?.agentModel ?? env.AGENT_MODEL}`, model: runtime.model }],
      persist: false,
      maxChunks: PREVIEW_MAX_TRIPLET_CHUNKS,
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'graph' }),
    });

    const previewResult = {
      ...result,
      originalMarkdown: doc.contentMarkdown,
      triplets: graphResult.triplets,
      chunkCount: graphResult.chunkCount,
      tripletCount: graphResult.tripletCount,
    };
    await job.updateProgress(100);
    await jobs.recordLifecycle(jobId, { ...lifecycle, status: 'completed', attempts, result: previewResult });
    return previewResult;
  } catch (error) {
    await jobs.recordLifecycle(jobId, {
      ...lifecycle,
      status: 'failed',
      attempts,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
    await docs.deletePreviewArtifacts(documentId);
  }
}

async function runCommitPreviewJob(job: MainJob, doc: DocumentDTO, jobId: string, documentId: string) {
  const attempts = job.attemptsMade + 1;
  const lifecycle = { queue: MAIN_QUEUE_NAME, type: 'PREVIEW' as const, documentId, title: doc.title };
  await jobs.recordLifecycle(jobId, { ...lifecycle, status: 'active', attempts });
  await job.updateProgress(5);
  const runtime = await loadJobRuntime();
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    await writeDocSnapshot(snapshotDir, doc);
    const result = await runMainPipeline(documentId, {
      db,
      sandbox: createSandbox(jobId),
      docsSnapshotDir: snapshotDir,
      jobId,
      embed: runtime.embed,
      model: runtime.model,
      embeddingModel: runtime.effective.models?.embeddingModel ?? env.EMBEDDING_MODEL,
      prompts: runtime.effective.prompts,
      agentParams: runtime.effective.agentParams,
      onStep: progressOnStep(job),
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'main' }),
    });

    await job.updateProgress({ type: 'phase', phase: 'graph', progress: 70 });
    const graphResult = await runGraphPipeline(documentId, {
      db,
      models: tripletModels.length > 0 ? tripletModels : [{ label: `openai:${runtime.effective.models?.agentModel ?? env.AGENT_MODEL}`, model: runtime.model }],
      persist: false,
      maxChunks: PREVIEW_MAX_TRIPLET_CHUNKS,
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'graph' }),
    });
    let reviewSkipped = false;
    if (!(await settings.get()).reviewApprovalEnabled) {
      const published = await docs.publish(documentId);
      if (!published) throw new Error(`Document not found while skipping review: ${documentId}`);
      await graphQueue.add('EXTRACT_TRIPLETS', { documentId }, defaultJobOptions());
      reviewSkipped = true;
    }

    const previewResult = {
      ...result,
      originalMarkdown: doc.contentMarkdown,
      triplets: graphResult.triplets,
      chunkCount: graphResult.chunkCount,
      tripletCount: graphResult.tripletCount,
      committed: true,
      reviewSkipped,
    };
    await job.updateProgress(100);
    await jobs.recordLifecycle(jobId, { ...lifecycle, status: 'completed', attempts, result: previewResult });
    return previewResult;
  } catch (error) {
    await jobs.recordLifecycle(jobId, {
      ...lifecycle,
      status: 'failed',
      attempts,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
}

const worker = createWorker<{ documentId: string; commit?: boolean }>(MAIN_QUEUE_NAME, async (job) => {
  const { documentId } = job.data;
  const jobId = String(job.id);
  const doc = await docs.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);
  if (job.name === 'PREVIEW') {
    return job.data.commit
      ? runCommitPreviewJob(job, doc, jobId, documentId)
      : runPreviewJob(job, doc, jobId, documentId);
  }
  return runIngestJob(job, doc, jobId, documentId);
});

worker.on('failed', (job, err) => {
  console.error(`[main-worker] job ${job?.id} failed:`, err.message);
});

console.log('WekiFlow main worker started');

async function shutdown() {
  await worker.close();
  await graphQueue.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
