import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createJobsRepo, getDb, closeMongoClient, loadRuntimeConfig } from '@wf/db';
import { createRedisConnection, createWorker, LEARNER_QUEUE_NAME } from '@wf/queue';
import { loadEnv } from '@wf/shared';
import { runLearnerJob, type LearnerJob } from './pipeline.js';

loadDotenv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
const env = loadEnv();
const db = await getDb();
const jobs = createJobsRepo(db);
const connection = createRedisConnection();

const worker = createWorker<LearnerJob>(
  LEARNER_QUEUE_NAME,
  async (job) => {
    const data = job.data;
    const workerJobId = String(job.id);
    await jobs.recordLifecycle(workerJobId, {
      queue: LEARNER_QUEUE_NAME,
      type: 'LEARN_TRAJECTORY',
      documentId: data.jobId,
      status: 'active',
      attempts: job.attemptsMade + 1,
      title: data.jobId,
    });
    try {
      const { effective } = await loadRuntimeConfig(db);
      const result = await runLearnerJob(data, {
        db,
        model: openai(effective.models?.agentModel ?? env.AGENT_MODEL),
        prompts: effective.prompts,
      });
      await jobs.recordLifecycle(workerJobId, {
        queue: LEARNER_QUEUE_NAME,
        type: 'LEARN_TRAJECTORY',
        documentId: data.jobId,
        status: 'completed',
        attempts: job.attemptsMade + 1,
        title: data.jobId,
        result,
      });
      return result;
    } catch (error) {
      await jobs.recordLifecycle(workerJobId, {
        queue: LEARNER_QUEUE_NAME,
        type: 'LEARN_TRAJECTORY',
        documentId: data.jobId,
        status: 'failed',
        attempts: job.attemptsMade + 1,
        title: data.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  connection,
);

worker.on('failed', (job, err) => {
  console.error(`[learner-worker] job ${job?.id} failed:`, err.message);
});

console.log('WekiFlow learner worker started');

async function shutdown() {
  await worker.close();
  await connection.quit();
  await closeMongoClient();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
