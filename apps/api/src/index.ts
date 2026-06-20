import { getDb } from '@wf/db';
import { createConversationQueue, createConversationQueueEvents, createGraphQueue, createMainQueue, createMainQueueEvents } from '@wf/queue';
import { MongoWekiFlowStore } from './mongoStore.js';
import { buildServer } from './server.js';

const db = await getDb();
const mainQueue = createMainQueue();
const graphQueue = createGraphQueue();
const conversationQueue = createConversationQueue();
const jobEvents = createMainQueueEvents();
const conversationJobEvents = createConversationQueueEvents();

const store = new MongoWekiFlowStore(db, mainQueue, graphQueue);
// Ensure the seeded owner exists before accepting logins (buildServer also calls
// seed() but does not await it; ensureOwner is idempotent so the double call is safe).
await store.seed();
const app = buildServer({ store, jobQueue: mainQueue, conversationQueue, jobEvents, conversationJobEvents });

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`WekiFlow API listening on http://localhost:${port}`);

async function shutdown() {
  await app.close();
  await Promise.allSettled([jobEvents.close(), conversationJobEvents.close(), mainQueue.close(), graphQueue.close(), conversationQueue.close()]);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
