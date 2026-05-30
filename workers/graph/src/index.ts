import { openai } from '@ai-sdk/openai';
import { closeMongoClient, createJobsRepo, getDb } from '@wf/db';
import { GRAPH_QUEUE_NAME, createRedisConnection, createWorker } from '@wf/queue';
import { loadEnv } from '@wf/shared';
import { runGraphPipeline } from './pipeline.js';

const env = loadEnv();
const db = await getDb();
const jobs = createJobsRepo(db);
const model = openai(env.AGENT_MODEL);
const connection = createRedisConnection();

const worker = createWorker<{ documentId: string }>(GRAPH_QUEUE_NAME, async (job) => {
  const { documentId } = job.data;
  const jobId = String(job.id);

  await jobs.recordLifecycle(jobId, {
    queue: GRAPH_QUEUE_NAME,
    type: 'EXTRACT_TRIPLETS',
    documentId,
    status: 'active',
    attempts: job.attemptsMade + 1,
  });
  await job.updateProgress(5);

  try {
    const result = await runGraphPipeline(documentId, {
      db,
      model,
      recordStep: (step) => jobs.appendAgentStep(jobId, step),
    });
    await job.updateProgress(100);
    await jobs.recordLifecycle(jobId, {
      queue: GRAPH_QUEUE_NAME,
      type: 'EXTRACT_TRIPLETS',
      documentId,
      status: 'completed',
      attempts: job.attemptsMade + 1,
    });
    return result;
  } catch (error) {
    await jobs.recordLifecycle(jobId, {
      queue: GRAPH_QUEUE_NAME,
      type: 'EXTRACT_TRIPLETS',
      documentId,
      status: 'failed',
      attempts: job.attemptsMade + 1,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}, connection);

worker.on('failed', (job, err) => {
  console.error(`[graph-worker] job ${job?.id} failed:`, err.message);
});

console.log('WekiFlow graph worker started');

async function shutdown() {
  await worker.close();
  await connection.quit();
  await closeMongoClient();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
