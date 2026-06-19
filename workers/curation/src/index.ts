import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { CURATION_QUEUE_NAME, createCurationQueue, createRedisConnection, createWorker } from '@wf/queue';
import { loadEnv } from '@wf/shared';
import { registerCurationSchedule, runCurationPlaceholder, runCurationScan } from './pipeline.js';

loadDotenv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
const env = loadEnv();
const bundlePath = env.WKF_BUNDLE_PATH ?? 'knowledge';
const connection = createRedisConnection();
const queue = createCurationQueue(connection);

await registerCurationSchedule(queue);

const worker = createWorker<{ type: 'SCAN_STALE' } | Parameters<typeof runCurationPlaceholder>[0]>(
  CURATION_QUEUE_NAME,
  async (job) => {
    if (job.name === 'SCAN_STALE') return runCurationScan(queue, bundlePath);
    return runCurationPlaceholder(job.data as Parameters<typeof runCurationPlaceholder>[0]);
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
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
