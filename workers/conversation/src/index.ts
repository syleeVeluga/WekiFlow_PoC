import type { Job } from 'bullmq';
import { getDb } from '@wf/db';
import { CONVERSATION_QUEUE_NAME, createWorker } from '@wf/queue';
import type { ConversationIngestRequest } from '@wf/shared';
import { runConversationIngest } from './pipeline.js';

export { runConversationIngest } from './pipeline.js';

const db = await getDb();

type ConversationJob = Job<ConversationIngestRequest>;

const worker = createWorker<ConversationIngestRequest>(CONVERSATION_QUEUE_NAME, async (job: ConversationJob) => {
  const result = await runConversationIngest(job.data, { db });
  await job.updateProgress(100);
  return { candidateIds: result.candidates.map((candidate) => candidate.id), sourceRef: result.sourceRef };
});

worker.on('completed', (job) => console.log(`[conversation-worker] completed ${job.id}`));
worker.on('failed', (job, error) => console.error(`[conversation-worker] failed ${job?.id}`, error));
