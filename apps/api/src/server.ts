import cors from '@fastify/cors';
import Fastify from 'fastify';
import { UserRoleSchema } from '@wf/shared';
import { InMemoryWekiFlowStore } from './store.js';

export function buildServer(store = new InMemoryWekiFlowStore()) {
  store.seed();
  const app = Fastify({ logger: false });
  void app.register(cors);

  app.get('/api/tree', async () => store.tree());

  app.get('/api/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = store.getDocument(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return doc;
  });

  app.post('/api/documents', async (request) => {
    const body = request.body as { title?: string; contentMarkdown?: string; parentId?: string | null };
    return store.ingest({
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

  app.post('/api/documents/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const role = UserRoleSchema.catch('VIEWER').parse(request.headers['x-user-role']);
    const result = store.approve(id, role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.post('/api/documents/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = store.reject(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return doc;
  });

  app.get('/api/jobs/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(`event: step\ndata: ${JSON.stringify({ jobId: id, status: 'stub' })}\n\n`);
    reply.raw.end();
  });

  return app;
}
