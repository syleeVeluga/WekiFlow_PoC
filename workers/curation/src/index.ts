import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createJobsRepo, createSandboxRunsRepo, getDb, closeMongoClient, loadRuntimeConfig } from '@wf/db';
import { CURATION_QUEUE_NAME, createCurationQueue, createRedisConnection, createWorker } from '@wf/queue';
import { DockerSandboxRunner } from '@wf/sandbox';
import { loadEnv } from '@wf/shared';
import { registerCurationSchedule, runCurationAgent, runCurationScan } from './pipeline.js';

loadDotenv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
const env = loadEnv();
const bundlePath = env.WKF_BUNDLE_PATH ?? 'knowledge';
const db = await getDb();
const jobs = createJobsRepo(db);
const sandboxRuns = createSandboxRunsRepo(db);
const connection = createRedisConnection();
const queue = createCurationQueue(connection);

await registerCurationSchedule(queue);

const worker = createWorker<{ type: 'SCAN_STALE' } | Parameters<typeof runCurationAgent>[0]>(
  CURATION_QUEUE_NAME,
  async (job) => {
    if (job.name === 'SCAN_STALE') return runCurationScan(queue, bundlePath);
    const data = job.data as Parameters<typeof runCurationAgent>[0];
    const jobId = String(job.id);
    await jobs.recordLifecycle(jobId, {
      queue: CURATION_QUEUE_NAME,
      type: 'CURATE_CONCEPT',
      documentId: data.concept.slug,
      status: 'active',
      attempts: job.attemptsMade + 1,
      title: data.concept.slug,
    });
    try {
      const { effective, overrides } = await loadRuntimeConfig(db);
      const result = await runCurationAgent(data, {
        db,
        sandbox: new DockerSandboxRunner({
          image: 'wekiflow/sandbox:latest',
          audit: (entry) => sandboxRuns.record({ jobId, ...entry }),
        }),
        bundlePath,
        docsSnapshotDir: bundlePath,
        jobId,
        model: openai(effective.models?.agentModel ?? env.AGENT_MODEL),
        prompts: effective.prompts,
        ...(overrides.agentParams ? { agentParams: overrides.agentParams } : {}),
        recordStep: (step) => jobs.appendAgentStep(jobId, step),
      });
      await jobs.recordLifecycle(jobId, {
        queue: CURATION_QUEUE_NAME,
        type: 'CURATE_CONCEPT',
        documentId: data.concept.slug,
        status: 'completed',
        attempts: job.attemptsMade + 1,
        title: data.concept.slug,
        result,
      });
      return result;
    } catch (error) {
      await jobs.recordLifecycle(jobId, {
        queue: CURATION_QUEUE_NAME,
        type: 'CURATE_CONCEPT',
        documentId: data.concept.slug,
        status: 'failed',
        attempts: job.attemptsMade + 1,
        title: data.concept.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  connection,
);

worker.on('failed', (job, err) => {
  console.error(`[curation-worker] job ${job?.id} failed:`, err.message);
});

console.log('WekiFlow curation worker started');

async function shutdown() {
  await worker.close();
  await queue.close();
  await connection.quit();
  await closeMongoClient();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
