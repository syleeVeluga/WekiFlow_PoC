import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from 'bullmq';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createDocumentsRepo, createJobsRepo, createSandboxRunsRepo, getDb } from '@wf/db';
import { MAIN_QUEUE_NAME, createWorker } from '@wf/queue';
import { DockerSandboxRunner } from '@wf/sandbox';
import { loadEnv, type DocumentDTO } from '@wf/shared';
import type { EmbedFn } from '@wf/agent-tools';
import { runGraphPipeline } from '@wf/graph-worker/pipeline';
import { runMainPipeline } from './pipeline.js';

export { runMainPipeline, indexDocumentChunks, extractMergeResult } from './pipeline.js';

const env = loadEnv();
const SANDBOX_IMAGE = 'wekiflow/sandbox:latest';
const PREVIEW_MAX_TRIPLET_CHUNKS = 24;

const db = await getDb();
const docs = createDocumentsRepo(db);
const jobs = createJobsRepo(db);
const sandboxRuns = createSandboxRunsRepo(db);

const model = openai(env.AGENT_MODEL);
const embeddingModel = openai.textEmbeddingModel(env.EMBEDDING_MODEL);
const embed: EmbedFn = async (texts) => (await embedMany({ model: embeddingModel, values: texts })).embeddings;

type MainJob = Job<{ documentId: string }>;

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

/** Normal ingest: run the agent, leave the REVIEW draft + chunks persisted. */
async function runIngestJob(job: MainJob, doc: DocumentDTO, jobId: string, documentId: string) {
  await job.updateProgress(5);
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    await writeDocSnapshot(snapshotDir, doc);
    const result = await runMainPipeline(documentId, {
      db,
      sandbox: createSandbox(jobId),
      docsSnapshotDir: snapshotDir,
      jobId,
      embed,
      model,
      embeddingModel: env.EMBEDDING_MODEL,
      onStep: progressOnStep(job),
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'main' }),
    });
    if (!result.merged) {
      console.warn(
        `[main-worker] job ${jobId}: agent produced no merge for ${documentId}; routed to REVIEW with original content.`,
      );
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
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    await writeDocSnapshot(snapshotDir, doc);
    const result = await runMainPipeline(documentId, {
      db,
      sandbox: createSandbox(jobId),
      docsSnapshotDir: snapshotDir,
      jobId,
      embed,
      model,
      embeddingModel: env.EMBEDDING_MODEL,
      preview: true,
      onStep: progressOnStep(job),
      recordStep: (step) => jobs.appendAgentStep(jobId, { ...step, phase: 'main' }),
    });

    await job.updateProgress({ type: 'phase', phase: 'graph', progress: 70 });
    const graphResult = await runGraphPipeline(documentId, {
      db,
      model,
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

const worker = createWorker<{ documentId: string }>(MAIN_QUEUE_NAME, async (job) => {
  const { documentId } = job.data;
  const jobId = String(job.id);
  const doc = await docs.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);
  return job.name === 'PREVIEW'
    ? runPreviewJob(job, doc, jobId, documentId)
    : runIngestJob(job, doc, jobId, documentId);
});

worker.on('failed', (job, err) => {
  console.error(`[main-worker] job ${job?.id} failed:`, err.message);
});

console.log('WekiFlow main worker started');

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
