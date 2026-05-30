import { getDb } from '@wf/db';
import { createGraphQueue, createMainQueue, createMainQueueEvents } from '@wf/queue';
import { MongoWekiFlowStore } from './mongoStore.js';
import { buildServer } from './server.js';

const db = await getDb();
const mainQueue = createMainQueue();
const graphQueue = createGraphQueue();
const jobEvents = createMainQueueEvents();

const store = new MongoWekiFlowStore(db, mainQueue, graphQueue);
const app = buildServer({ store, jobQueue: mainQueue, jobEvents });

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`WekiFlow API listening on http://localhost:${port}`);

async function shutdown() {
  await app.close();
  await Promise.allSettled([jobEvents.close(), mainQueue.close(), graphQueue.close()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
