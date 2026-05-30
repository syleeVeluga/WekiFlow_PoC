import cors from '@fastify/cors';
import type { Queue, QueueEvents } from 'bullmq';
import Fastify from 'fastify';
import { KnowledgeQuerySchema, MsResolveBodySchema, UserRoleSchema } from '@wf/shared';
import { InMemoryWekiFlowStore, type WekiFlowStore } from './store.js';

export interface BuildServerOptions {
  store?: WekiFlowStore;
  jobQueue?: Queue;
  jobEvents?: QueueEvents;
}

export function buildServer({
  store = new InMemoryWekiFlowStore(),
  jobQueue,
  jobEvents,
}: BuildServerOptions = {}) {
  store.seed?.();
  const app = Fastify({ logger: false });
  void app.register(cors);

  app.get('/api/tree', async () => store.tree());

  app.get('/api/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await store.getDocument(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return doc;
  });

  app.post('/api/documents', async (request) => {
    const body = request.body as { title?: string; contentMarkdown?: string; parentId?: string | null };
    return store.createDocument({
      title: body.title ?? 'Untitled',
      contentMarkdown: body.contentMarkdown ?? '',
      parentId: body.parentId ?? null,
    });
  });

  app.post('/api/ingest', async (request) => {
    const body = request.body as { title?: string; contentMarkdown?: string; parentId?: string | null };
    return store.ingest({
      title: body.title ?? 'Manual Ingest',
      contentMarkdown: body.contentMarkdown ?? '',
      parentId: body.parentId ?? null,
    });
  });

  app.get('/api/reviews', async () => store.reviews());

  app.get('/api/knowledge', async (request) => store.listKnowledge(KnowledgeQuerySchema.parse(request.query)));

  app.get('/api/knowledge/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await store.getKnowledge(id);
    if (!item) return reply.code(404).send({ error: 'Not found' });
    return item;
  });

  app.patch('/api/knowledge/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { contentMarkdown?: string };
    const item = await store.patchKnowledge(id, { contentMarkdown: body.contentMarkdown ?? '' });
    if (!item) return reply.code(404).send({ error: 'Not found' });
    return item;
  });

  app.get('/api/topics', async () => store.listTopics());

  app.post('/api/topics', async (request) => {
    const body = request.body as { name?: string };
    return store.createTopic((body.name ?? '새 주제').trim());
  });

  app.delete('/api/topics/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await store.deleteTopic(id);
    if (!result.ok) return reply.code(result.statusCode ?? 400).send({ error: result.error ?? 'Failed' });
    return result;
  });

  app.get('/api/ai-tag-suggestions', async () => store.listAiTagSuggestions());

  app.post('/api/ai-tag-suggestions/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: 'approve' | 'reject' };
    if (action !== 'approve' && action !== 'reject') return reply.code(400).send({ error: 'Invalid action' });
    return store.resolveAiTagSuggestion(id, action);
  });

  app.get('/api/reviews/rich', async () => store.listRichReviews());

  app.post('/api/reviews/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: 'approve' | 'reject' };
    if (action !== 'approve' && action !== 'reject') return reply.code(400).send({ error: 'Invalid action' });
    const role = UserRoleSchema.catch('VIEWER').parse(request.headers['x-user-role']);
    const result = await store.resolveReview(id, action, role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.get('/api/multi-source', async () => store.listMultiSource());

  app.post('/api/multi-source/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = UserRoleSchema.catch('VIEWER').parse(request.headers['x-user-role']);
    const body = MsResolveBodySchema.parse(request.body);
    const result = await store.resolveMultiSource(id, body, role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.post('/api/multi-source/:id/split', async (request) => {
    const { id } = request.params as { id: string };
    return store.splitMultiSource(id);
  });

  app.post('/api/multi-source/:id/request-confirm', async (request) => {
    const { id } = request.params as { id: string };
    return store.requestConfirmMultiSource(id);
  });

  app.get('/api/home/digest', async () => store.homeDigest());
  app.get('/api/activity', async (request) => {
    const q = request.query as { limit?: string };
    return store.listActivity(q.limit ? Number(q.limit) : undefined);
  });
  app.get('/api/tree/categories', async () => store.treeCategories());

  app.post('/api/documents/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = UserRoleSchema.catch('VIEWER').parse(request.headers['x-user-role']);
    const result = await store.approve(id, role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.post('/api/documents/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await store.reject(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return doc;
  });

  app.get('/api/jobs/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (!jobEvents || !jobQueue) {
      // No live queue (e.g. in-memory/test): emit a single stub event and close.
      send('step', { jobId: id, status: 'stub' });
      res.end();
      return;
    }

    const liveJobEvents = jobEvents;
    const liveJobQueue = jobQueue;
    let closed = false;

    const onProgress = ({ jobId, data }: { jobId: string; data: unknown }) => {
      if (jobId === id) send('progress', { jobId, progress: data });
    };
    const onCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: unknown }) => {
      if (jobId !== id) return;
      send('completed', { jobId, result: returnvalue });
      closeStream();
    };
    const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
      if (jobId !== id) return;
      send('failed', { jobId, error: failedReason });
      closeStream();
    };

    function cleanup() {
      liveJobEvents.off('progress', onProgress);
      liveJobEvents.off('completed', onCompleted);
      liveJobEvents.off('failed', onFailed);
      request.raw.off('close', cleanup);
    }

    function closeStream() {
      if (closed) return;
      closed = true;
      cleanup();
      res.end();
    }

    liveJobEvents.on('progress', onProgress);
    liveJobEvents.on('completed', onCompleted);
    liveJobEvents.on('failed', onFailed);
    request.raw.on('close', cleanup);

    const job = await liveJobQueue.getJob(id);
    if (!job) {
      send('failed', { jobId: id, error: 'Job not found' });
      closeStream();
      return;
    }

    const state = await job.getState();
    if (state === 'completed') {
      send('completed', { jobId: id, result: job.returnvalue });
      closeStream();
      return;
    }
    if (state === 'failed') {
      send('failed', { jobId: id, error: job.failedReason ?? 'Job failed' });
      closeStream();
      return;
    }
    send('progress', { jobId: id, progress: job.progress });
  });

  return app;
}
