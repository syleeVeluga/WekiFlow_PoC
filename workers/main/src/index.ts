import { createDocumentsRepo, getDb } from '@wf/db';
import { MAIN_QUEUE_NAME, createWorker } from '@wf/queue';
import { runMainPipelineStub } from './pipeline.js';

export { runMainPipelineStub } from './pipeline.js';

const db = await getDb();
const docs = createDocumentsRepo(db);

const worker = createWorker<{ documentId: string }>(MAIN_QUEUE_NAME, async (job) => {
  const { documentId } = job.data;
  const doc = await docs.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  await job.updateProgress(10);
  const { draftMarkdown } = await runMainPipelineStub({
    documentId,
    contentMarkdown: doc.contentMarkdown,
  });
  await job.updateProgress(80);

  await docs.setDraft(documentId, draftMarkdown); // status -> REVIEW
  await job.updateProgress(100);

  return { documentId, status: 'REVIEW' as const };
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
