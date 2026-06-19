import { Queue, QueueEvents, Worker, type JobsOptions, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { loadEnv, type JobType } from '@wf/shared';

export const MAIN_QUEUE_NAME = 'main';
export const GRAPH_QUEUE_NAME = 'graph';
export const CURATION_QUEUE_NAME = 'curation';
export const LEARNER_QUEUE_NAME = 'learner';

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

export function createCurationQueue(connection = createRedisConnection()) {
  return new Queue(CURATION_QUEUE_NAME, { connection, prefix: 'wf:curation' });
}

export function createLearnerQueue(connection = createRedisConnection()) {
  return new Queue(LEARNER_QUEUE_NAME, { connection, prefix: 'wf:learner' });
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

export interface WorkerRuntimeOptions {
  concurrency?: number;
  limiter?: { max: number; duration: number };
}

function workerRuntimeOptions(
  queueName: typeof MAIN_QUEUE_NAME | typeof GRAPH_QUEUE_NAME | typeof CURATION_QUEUE_NAME | typeof LEARNER_QUEUE_NAME,
  options: WorkerRuntimeOptions = {},
) {
  const env = loadEnv();
  const concurrency =
    options.concurrency ??
    (queueName === MAIN_QUEUE_NAME
      ? env.MAIN_WORKER_CONCURRENCY
      : queueName === GRAPH_QUEUE_NAME
        ? env.GRAPH_WORKER_CONCURRENCY
        : queueName === CURATION_QUEUE_NAME
          ? env.CURATION_WORKER_CONCURRENCY
          : env.LEARNER_WORKER_CONCURRENCY);
  const rateMax =
    queueName === MAIN_QUEUE_NAME
      ? env.MAIN_QUEUE_RATE_MAX
      : queueName === GRAPH_QUEUE_NAME
        ? env.GRAPH_QUEUE_RATE_MAX
        : queueName === CURATION_QUEUE_NAME
          ? env.CURATION_QUEUE_RATE_MAX
          : env.LEARNER_QUEUE_RATE_MAX;
  const rateDuration =
    queueName === MAIN_QUEUE_NAME
      ? env.MAIN_QUEUE_RATE_DURATION_MS
      : queueName === GRAPH_QUEUE_NAME
        ? env.GRAPH_QUEUE_RATE_DURATION_MS
        : queueName === CURATION_QUEUE_NAME
          ? env.CURATION_QUEUE_RATE_DURATION_MS
          : env.LEARNER_QUEUE_RATE_DURATION_MS;
  const limiter = options.limiter ?? (rateMax > 0 ? { max: rateMax, duration: rateDuration } : undefined);
  return limiter ? { concurrency, limiter } : { concurrency };
}

export function createWorker<T>(
  queueName: typeof MAIN_QUEUE_NAME | typeof GRAPH_QUEUE_NAME | typeof CURATION_QUEUE_NAME | typeof LEARNER_QUEUE_NAME,
  processor: Processor<T>,
  connection = createRedisConnection(),
  options: WorkerRuntimeOptions = {},
) {
  return new Worker(queueName, processor, {
    connection,
    prefix:
      queueName === MAIN_QUEUE_NAME
        ? 'wf:main'
        : queueName === GRAPH_QUEUE_NAME
          ? 'wf:graph'
          : queueName === CURATION_QUEUE_NAME
            ? 'wf:curation'
            : 'wf:learner',
    ...workerRuntimeOptions(queueName, options),
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
