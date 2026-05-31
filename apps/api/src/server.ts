import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { Queue, QueueEvents } from 'bullmq';
import Fastify, { type FastifyRequest } from 'fastify';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { ZodError } from 'zod';
import {
  AgentPreviewRequestSchema,
  CreateUserBodySchema,
  KnowledgeQuerySchema,
  LoginBodySchema,
  MsResolveBodySchema,
  UpdateUserRoleBodySchema,
  type User,
  canManageOwners,
  canManageUsers,
  canReview,
} from '@wf/shared';
import { InMemoryWekiFlowStore, type WekiFlowStore } from './store.js';

const PREVIEW_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const PREVIEW_MAX_CHARS = 120_000;
const PREVIEW_MAX_PDF_PAGES = 20;

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
  void app.register(multipart, { limits: { fileSize: PREVIEW_MAX_UPLOAD_BYTES, files: 1 } });

  // Resolve the logged-in user from the `Authorization: Bearer <token>` header.
  async function currentUser(request: FastifyRequest): Promise<User | undefined> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return undefined;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return undefined;
    return store.me(token);
  }

  async function ownerFromQueryToken(request: FastifyRequest): Promise<User | undefined> {
    const { token } = request.query as { token?: string };
    if (!token) return undefined;
    return store.me(token);
  }

  function capPreviewText(text: string): string {
    return text.slice(0, PREVIEW_MAX_CHARS);
  }

  async function extractPreviewPdf(buffer: Buffer): Promise<string> {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      return capPreviewText(text.slice(0, PREVIEW_MAX_PDF_PAGES).join('\n\n'));
    } finally {
      await pdf.destroy();
    }
  }

  async function extractPreviewFile(filename: string, buffer: Buffer): Promise<string> {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') return extractPreviewPdf(buffer);
    if (ext === '.md' || ext === '.txt') return capPreviewText(buffer.toString('utf8'));
    throw new Error('Unsupported preview file type');
  }

  async function readAgentPreviewInput(request: FastifyRequest): Promise<{ title: string; contentMarkdown: string }> {
    if (request.isMultipart()) {
      let title = '';
      let fileName = '';
      let contentMarkdown = '';
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          fileName = part.filename;
          contentMarkdown = await extractPreviewFile(part.filename, await part.toBuffer());
        } else if (part.fieldname === 'title' && typeof part.value === 'string') {
          title = part.value.trim();
        }
      }
      return {
        title: title || path.parse(fileName).name || '에이전트 미리보기',
        contentMarkdown,
      };
    }

    const body = AgentPreviewRequestSchema.parse(request.body);
    return {
      title: body.title?.trim() || '에이전트 미리보기',
      contentMarkdown: capPreviewText(body.message),
    };
  }

  function writeSse(res: import('node:http').ServerResponse, event: string, data: unknown) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // --- Auth ---
  app.post('/api/auth/login', async (request, reply) => {
    const body = LoginBodySchema.parse(request.body);
    const result = await store.login(body.email, body.password);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return { token: result.token, user: result.user };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    return user;
  });

  app.post('/api/auth/logout', async (request) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) await store.logout(header.slice('Bearer '.length).trim());
    return { ok: true };
  });

  // --- User management (소유자 + 승인; 소유자 역할/계정은 소유자만) ---
  app.get('/api/users', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageUsers(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    return store.listUsers();
  });

  app.post('/api/users', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageUsers(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const body = CreateUserBodySchema.parse(request.body);
    if (body.role === 'OWNER' && !canManageOwners(me.role)) {
      return reply.code(403).send({ error: '소유자 역할은 소유자만 부여할 수 있습니다.' });
    }
    const result = await store.createUser(body);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result.user;
  });

  app.patch('/api/users/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageUsers(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const body = UpdateUserRoleBodySchema.parse(request.body);
    const target = (await store.listUsers()).find((user) => user.id === id);
    if (!canManageOwners(me.role) && (body.role === 'OWNER' || target?.role === 'OWNER')) {
      return reply.code(403).send({ error: '소유자 권한 변경은 소유자만 가능합니다.' });
    }
    const result = await store.updateUserRole(id, body.role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result.user;
  });

  app.delete('/api/users/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageUsers(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    if (id === me.id) return reply.code(400).send({ error: '본인 계정은 삭제할 수 없습니다.' });
    const target = (await store.listUsers()).find((user) => user.id === id);
    if (!canManageOwners(me.role) && target?.role === 'OWNER') {
      return reply.code(403).send({ error: '소유자 계정은 소유자만 삭제할 수 있습니다.' });
    }
    const result = await store.deleteUser(id);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

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
    const me = await currentUser(request);
    const result = await store.resolveReview(id, action, me?.role ?? 'VIEWER');
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.get('/api/multi-source', async () => store.listMultiSource());

  app.post('/api/multi-source/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = await currentUser(request);
    const body = MsResolveBodySchema.parse(request.body);
    const result = await store.resolveMultiSource(id, body, me?.role ?? 'VIEWER');
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.post('/api/multi-source/:id/split', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canReview(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    return store.splitMultiSource(id);
  });

  app.post('/api/multi-source/:id/request-confirm', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canReview(me.role)) return reply.code(403).send({ error: 'Forbidden' });
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
    const me = await currentUser(request);
    const result = await store.approve(id, me?.role ?? 'VIEWER');
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result;
  });

  app.post('/api/documents/:id/reject', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canReview(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const doc = await store.reject(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return doc;
  });

  app.post('/api/agent-preview', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageOwners(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    let input: { title: string; contentMarkdown: string };
    try {
      input = await readAgentPreviewInput(request);
    } catch (error) {
      if (error instanceof Error && error.message === 'Unsupported preview file type') {
        return reply.code(415).send({ error: error.message });
      }
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid preview request' });
      }
      throw error;
    }
    if (!input.contentMarkdown.trim()) return reply.code(422).send({ error: 'Preview input is empty' });
    return store.agentPreview(input);
  });

  app.get('/api/agent-preview', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageOwners(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    return store.listAgentPreviews();
  });

  app.get('/api/agent-preview/:jobId', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canManageOwners(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { jobId } = request.params as { jobId: string };
    const run = await store.getAgentPreview(jobId);
    if (!run) return reply.code(404).send({ error: 'Not found' });
    return run;
  });

  app.get('/api/agent-preview/:jobId/stream', async (request, reply) => {
    const me = await ownerFromQueryToken(request);
    if (!me || !canManageOwners(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { jobId } = request.params as { jobId: string };

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    let closed = false;
    let lastStepIndex = 0;
    let timer: NodeJS.Timeout | undefined;
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, 15_000);

    const closeStream = () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      request.raw.off('close', closeStream);
      res.end();
    };

    const emit = async () => {
      const run = await store.getAgentPreview(jobId);
      if (closed) return; // client may have disconnected during the await
      if (!run) {
        writeSse(res, 'failed', { jobId, error: 'Job not found' });
        closeStream();
        return;
      }

      const nextSteps = run.steps.slice(lastStepIndex);
      nextSteps.forEach((step, offset) => {
        writeSse(res, 'step', { jobId, index: lastStepIndex + offset, step });
      });
      lastStepIndex = run.steps.length;

      if (run.status === 'completed') {
        writeSse(res, 'completed', { jobId, result: run.result });
        closeStream();
      } else if (run.status === 'failed') {
        writeSse(res, 'failed', { jobId, error: run.error ?? 'Job failed' });
        closeStream();
      }
    };

    // Single serialized poll loop: each tick waits for the previous emit to finish before scheduling
    // the next, so emits never overlap (no duplicate writes / racy lastStepIndex).
    const tick = () => {
      void emit().then(
        () => {
          if (!closed) timer = setTimeout(tick, 500);
        },
        (error) => {
          if (!closed) {
            writeSse(res, 'failed', { jobId, error: error instanceof Error ? error.message : String(error) });
          }
          closeStream();
        },
      );
    };

    request.raw.on('close', closeStream);
    tick();
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
