import { Queue, QueueEvents, Worker, type JobsOptions, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv, type JobType } from '@wf/shared';

export const MAIN_QUEUE_NAME = 'main';
export const GRAPH_QUEUE_NAME = 'graph';

export function createRedisConnection() {
  const env = loadEnv();
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function createMainQueue(connection = createRedisConnection()) {
  return new Queue(MAIN_QUEUE_NAME, { connection, prefix: 'wf:main' });
}

export function createGraphQueue(connection = createRedisConnection()) {
  return new Queue(GRAPH_QUEUE_NAME, { connection, prefix: 'wf:graph' });
}

export function createMainQueueEvents(connection = createRedisConnection()) {
  return new QueueEvents(MAIN_QUEUE_NAME, { connection, prefix: 'wf:main' });
}

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

export function createWorker<T>(
  queueName: typeof MAIN_QUEUE_NAME | typeof GRAPH_QUEUE_NAME,
  processor: Processor<T>,
  connection = createRedisConnection(),
) {
  return new Worker(queueName, processor, {
    connection,
    prefix: queueName === MAIN_QUEUE_NAME ? 'wf:main' : 'wf:graph',
    concurrency: 2,
  });
}

export interface InMemoryJob {
  id: string;
  type: JobType;
  documentId: string;
  createdAt: string;
}

export class InMemoryQueue {
  readonly jobs: InMemoryJob[] = [];

  add(type: JobType, data: { documentId: string }): InMemoryJob {
    const job = {
      id: `${type.toLowerCase()}-${this.jobs.length + 1}`,
      type,
      documentId: data.documentId,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    return job;
  }
}
