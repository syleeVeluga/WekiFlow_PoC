import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createDocumentsRepo, createJobsRepo, createSandboxRunsRepo, getDb } from '@wf/db';
import { MAIN_QUEUE_NAME, createWorker } from '@wf/queue';
import { DockerSandboxRunner } from '@wf/sandbox';
import { loadEnv } from '@wf/shared';
import type { EmbedFn } from '@wf/agent-tools';
import { runMainPipeline } from './pipeline.js';

export { runMainPipeline, indexDocumentChunks, extractMergeResult } from './pipeline.js';

const env = loadEnv();
const SANDBOX_IMAGE = 'wekiflow/sandbox:latest';

const db = await getDb();
const docs = createDocumentsRepo(db);
const jobs = createJobsRepo(db);
const sandboxRuns = createSandboxRunsRepo(db);

const model = openai(env.AGENT_MODEL);
const embeddingModel = openai.textEmbeddingModel(env.EMBEDDING_MODEL);
const embed: EmbedFn = async (texts) => (await embedMany({ model: embeddingModel, values: texts })).embeddings;

const worker = createWorker<{ documentId: string }>(MAIN_QUEUE_NAME, async (job) => {
  const { documentId } = job.data;
  const jobId = String(job.id);
  const doc = await docs.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  await job.updateProgress(5);

  // Sync the document into a per-job temp dir mounted read-only at /docs.
  const snapshotDir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
  try {
    const fileName = `${(doc.slug || 'document').replace(/[^\p{L}\p{N}-]+/gu, '-')}.md`;
    await writeFile(path.join(snapshotDir, fileName), doc.contentMarkdown, 'utf8');

    const sandbox = new DockerSandboxRunner({
      image: SANDBOX_IMAGE,
      audit: (entry) => sandboxRuns.record({ jobId, ...entry }),
    });

    const result = await runMainPipeline(documentId, {
      db,
      sandbox,
      docsSnapshotDir: snapshotDir,
      jobId,
      embed,
      model,
      embeddingModel: env.EMBEDDING_MODEL,
      onStep: (step) => {
        const calls = (step as { toolCalls?: Array<{ toolName: string }> }).toolCalls ?? [];
        return job.updateProgress({ type: 'step', tools: calls.map((c) => c.toolName) });
      },
      recordStep: (step) => jobs.appendAgentStep(jobId, step),
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
