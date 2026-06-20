import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { Queue, QueueEvents } from 'bullmq';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { z, ZodError } from 'zod';
import {
  AgentPreviewRequestSchema,
  AskResponseSchema,
  ConversationIngestRequestSchema,
  CreateKnowledgeCandidateSchema,
  CreateUserBodySchema,
  ExternalIngestionRequestSchema,
  IngestRequestSchema,
  KnowledgeQuerySchema,
  KnowledgeCandidateListQuerySchema,
  LoginBodySchema,
  MsResolveBodySchema,
  ResolveCandidateRouteBodySchema,
  RuntimeConfigPatchSchema,
  UpdateKnowledgeCandidateStatusSchema,
  UpdateAppSettingsSchema,
  UpdateUserRoleBodySchema,
  type AskCitation,
  type AskFollowUp,
  type AskResponse,
  type CandidateStatus,
  type User,
  canAccessDevPanel,
  canApprove,
  canEdit,
  canManageOwners,
  canManageUsers,
  canReview,
} from '@wf/shared';
import { extractConversationCandidates } from '@wf/agent-tools';
import { getConnector } from '@wf/connectors';
import { PolicyError, PolicySchema, defaultPolicy, enforcePolicy, knowledgeItemsToLinkGraph, loadEffectivePolicy, parse as parseWkf, routeCandidate, type Policy } from '@wekiflow/wkf';
import { InMemoryWekiFlowStore, type IngestInput, type IngestResult, type WekiFlowStore } from './store.js';

// Shared cap for both upload routes (/api/ingest/file and /api/agent-preview).
const INGEST_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const INGEST_MAX_FILES = 20;
const INGEST_MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const EXTERNAL_RATE_LIMIT_MAX = 60;
const EXTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;
const QUEUE_BACKLOG_LIMIT = 1_000;
const BACKLOG_RETRY_AFTER_SECONDS = 60;
const PREVIEW_MAX_CHARS = 120_000;
const PREVIEW_MAX_PDF_PAGES = 20;

/** Carries an HTTP status for upload-handling failures so the error handler can map it. */
class UploadError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'UploadError';
  }
}

interface UploadedTextFile {
  fileName: string;
  contentMarkdown: string;
  contentType: string;
  size: number;
}

export interface FixedWindowRateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
};

class InMemoryFixedWindowRateLimiter implements FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: bucket.count <= limit,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }
}

class RedisFixedWindowRateLimiter implements FixedWindowRateLimiter {
  constructor(private readonly client: Promise<unknown>) {}

  async hit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const redis = (await this.client) as RedisLike;
    const count = await redis.incr(key);
    let ttl = await redis.pttl(key);
    // Self-heal a key with no expiry: if a crash landed between INCR and PEXPIRE on a prior request,
    // pttl is -1 and the bucket would otherwise stay wedged above the limit forever.
    if (ttl < 0) {
      await redis.pexpire(key, windowMs);
      ttl = windowMs;
    }
    return { allowed: count <= limit, retryAfterMs: ttl };
  }
}

export interface BuildServerOptions {
  store?: WekiFlowStore;
  jobQueue?: Queue;
  conversationQueue?: Queue;
  jobEvents?: QueueEvents;
  conversationJobEvents?: QueueEvents;
  rateLimiter?: FixedWindowRateLimiter;
  externalRateLimit?: { max: number; windowMs: number };
  maxQueueBacklog?: number;
  reviewPolicy?: Policy;
  discoveryAsk?: (input: { question: string; user?: User }) => Promise<string | AskResponse>;
}

export function buildServer({
  store = new InMemoryWekiFlowStore(),
  jobQueue,
  conversationQueue,
  jobEvents,
  conversationJobEvents,
  rateLimiter,
  externalRateLimit = { max: EXTERNAL_RATE_LIMIT_MAX, windowMs: EXTERNAL_RATE_LIMIT_WINDOW_MS },
  maxQueueBacklog = QUEUE_BACKLOG_LIMIT,
  reviewPolicy,
  discoveryAsk,
}: BuildServerOptions = {}) {
  store.seed?.();
  const app = Fastify({ logger: false });
  void app.register(cors);
  void app.register(multipart, { limits: { fileSize: INGEST_MAX_UPLOAD_BYTES, files: INGEST_MAX_FILES } });
  // Resolved lazily on the first rate-limit check. Reading `jobQueue.client` eagerly here would open
  // the Redis connection at build time even for routes/tests that never rate-limit.
  let resolvedLimiter = rateLimiter;
  function getLimiter(): FixedWindowRateLimiter {
    if (!resolvedLimiter) {
      const client = (jobQueue as { client?: Promise<unknown> } | undefined)?.client;
      resolvedLimiter = client ? new RedisFixedWindowRateLimiter(client) : new InMemoryFixedWindowRateLimiter();
    }
    return resolvedLimiter;
  }

  // Map known error shapes to client-facing statuses; everything else is a 500.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UploadError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    const { statusCode = 500, message = 'Request failed' } = (error ?? {}) as { statusCode?: number; message?: string };
    return reply.code(statusCode).send({ error: statusCode >= 500 ? 'Internal Server Error' : message });
  });

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

  async function requireDevPanelUser(request: FastifyRequest, reply: FastifyReply): Promise<User | undefined> {
    const me = await currentUser(request);
    if (!me || !canAccessDevPanel(me)) {
      reply.code(403).send({ error: 'Forbidden' });
      return undefined;
    }
    return me;
  }

  async function currentRuntimePolicy(): Promise<Policy> {
    if (reviewPolicy) return reviewPolicy;
    const config = await store.runtimeConfig();
    if (config.overrides.policy) return PolicySchema.parse(config.overrides.policy);
    return process.env.WKF_BUNDLE_PATH ? loadEffectivePolicy(null, process.env.WKF_BUNDLE_PATH) : defaultPolicy;
  }

  async function policyResponse() {
    const config = await store.runtimeConfig();
    const defaults = process.env.WKF_BUNDLE_PATH ? await loadEffectivePolicy(null, process.env.WKF_BUNDLE_PATH) : defaultPolicy;
    const overrides = config.overrides.policy;
    return {
      defaults,
      overrides,
      effective: overrides ? PolicySchema.parse(overrides) : defaults,
    };
  }

  app.addHook('preHandler', async (request, reply) => {
    const pathOnly = request.url.split('?')[0] ?? request.url;
    if (!pathOnly.startsWith('/api/admin/')) return;
    const me = await requireDevPanelUser(request, reply);
    if (!me) return reply;
  });

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
    if (ext === '.pdf') {
      try {
        return await extractPreviewPdf(buffer);
      } catch {
        throw new UploadError('Could not read uploaded PDF', 422);
      }
    }
    if (ext === '.md' || ext === '.txt') return capPreviewText(buffer.toString('utf8'));
    throw new UploadError('Unsupported file type', 415);
  }

  // Drains a multipart request, extracting uploaded file text and trimmed field values.
  async function collectUploadParts(
    request: FastifyRequest,
    options: { maxFiles?: number } = {},
  ): Promise<{ files: UploadedTextFile[]; fields: Record<string, string> }> {
    const maxFiles = options.maxFiles ?? 1;
    const files: UploadedTextFile[] = [];
    const fields: Record<string, string> = {};
    let totalBytes = 0;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (files.length >= maxFiles) throw new UploadError('Too many files', 413);
        const buffer = await part.toBuffer();
        totalBytes += buffer.byteLength;
        if (totalBytes > INGEST_MAX_REQUEST_BYTES) throw new UploadError('Upload request is too large', 413);
        files.push({
          fileName: part.filename,
          contentType: part.mimetype || 'application/octet-stream',
          contentMarkdown: await extractPreviewFile(part.filename, buffer),
          size: buffer.byteLength,
        });
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value.trim();
      }
    }
    return { files, fields };
  }

  function firstUpload(files: UploadedTextFile[]): UploadedTextFile {
    const file = files[0];
    if (!file) throw new UploadError('No file uploaded', 400);
    return file;
  }

  function titleForFile(title: string | undefined, fileName: string, fileCount: number): string {
    const base = title?.trim();
    const fileTitle = path.parse(fileName).name || fileName || 'Uploaded document';
    if (!base) return fileTitle;
    return fileCount > 1 ? `${base} - ${fileTitle}` : base;
  }

  function assertNonEmptyUploadFiles(files: UploadedTextFile[]) {
    for (const file of files) {
      if (!file.contentMarkdown.trim()) throw new UploadError('Upload content is empty', 422);
    }
  }

  function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
    if (!value) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new UploadError('metadata must be valid JSON', 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UploadError('metadata must be a JSON object', 400);
    }
    return parsed as Record<string, unknown>;
  }

  async function readAgentPreviewInput(request: FastifyRequest): Promise<{ title: string; contentMarkdown: string; commit: boolean }> {
    if (request.isMultipart()) {
      const { files, fields } = await collectUploadParts(request, { maxFiles: 1 });
      const file = firstUpload(files);
      return {
        title: fields.title || path.parse(file.fileName).name || '에이전트 미리보기',
        contentMarkdown: file.contentMarkdown,
        commit: fields.commit === 'true',
      };
    }

    const body = AgentPreviewRequestSchema.parse(request.body);
    return {
      title: body.title?.trim() || '에이전트 미리보기',
      contentMarkdown: capPreviewText(body.message),
      commit: body.commit ?? false,
    };
  }

  async function readIngestFileInput(request: FastifyRequest) {
    if (!request.isMultipart()) throw new UploadError('Expected multipart upload', 400);
    const { files, fields } = await collectUploadParts(request, { maxFiles: 1 });
    const file = firstUpload(files);
    return IngestRequestSchema.parse({
      title: fields.title || path.parse(file.fileName).name || 'Uploaded document',
      contentMarkdown: file.contentMarkdown,
      topic: fields.topic || undefined,
      workspace: fields.workspace || fields.department || undefined,
      sourceLabel: fields.sourceLabel || file.fileName || undefined,
    });
  }

  async function readIngestFilesInput(request: FastifyRequest) {
    if (!request.isMultipart()) throw new UploadError('Expected multipart upload', 400);
    const { files, fields } = await collectUploadParts(request, { maxFiles: INGEST_MAX_FILES });
    if (files.length === 0) throw new UploadError('No file uploaded', 400);
    assertNonEmptyUploadFiles(files);
    return files.map((file) =>
      IngestRequestSchema.parse({
        title: titleForFile(fields.title, file.fileName, files.length),
        contentMarkdown: file.contentMarkdown,
        topic: fields.topic || undefined,
        workspace: fields.workspace || fields.department || undefined,
        sourceLabel: fields.sourceLabel || file.fileName || undefined,
      }),
    );
  }

  async function ensureIngestCapacity(reply: FastifyReply): Promise<boolean> {
    if (!jobQueue) return true;
    // Only pending work counts as backlog; 'active' jobs are already being drained by workers, so
    // including them would reject admissions on a healthy, fully-saturated queue.
    const counts = await jobQueue.getJobCounts('waiting', 'delayed', 'prioritized');
    const backlog = Object.values(counts).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    if (backlog < maxQueueBacklog) return true;
    reply.header('Retry-After', String(BACKLOG_RETRY_AFTER_SECONDS));
    reply.code(503).send({ error: 'Ingestion queue is busy. Retry later.' });
    return false;
  }

  async function enforceExternalRateLimit(
    reply: FastifyReply,
    input: { userId: string; workspaceId: string },
  ): Promise<boolean> {
    // Key on the authenticated principal + workspace only. `sourceName` is caller-chosen and
    // unbounded, so including it would let a client bypass the limit by varying that field.
    const key = ['external-ingest', input.userId, input.workspaceId].join(':');
    const result = await getLimiter().hit(key, externalRateLimit.max, externalRateLimit.windowMs);
    if (result.allowed) return true;
    const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    reply.header('Retry-After', String(retryAfter));
    reply.code(429).send({ error: 'Rate limit exceeded' });
    return false;
  }

  function externalIngestResponse(result: IngestResult) {
    return {
      id: result.doc.id,
      documentId: result.doc.id,
      jobId: result.job.id,
      replayed: result.replayed ?? false,
    };
  }

  // Ingests a batch of independent inputs concurrently (each file is unrelated), pairing every input
  // with its result so callers can shape the per-item response. Used by both upload-batch routes.
  async function runIngestBatch<T>(
    items: T[],
    toInput: (item: T, index: number) => IngestInput,
  ): Promise<Array<{ item: T; result: IngestResult }>> {
    const results = await Promise.all(items.map((item, index) => store.ingest(toInput(item, index))));
    return results.map((result, index) => ({ item: items[index]!, result }));
  }

  function externalIngestInput(input: {
    userId: string;
    workspaceId: string;
    sourceName: string;
    contentMarkdown: string;
    contentType: string;
    title: string;
    idempotencyKey?: string;
    sourceLabel?: string;
    topic?: string;
    metadata?: Record<string, unknown>;
  }): IngestInput {
    const sourceLabel = input.sourceLabel?.trim() || input.sourceName;
    return {
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      workspace: input.workspaceId,
      sourceLabel,
      sourceName: input.sourceName,
      contentType: input.contentType,
      sourceType: 'api',
      sourceRef: `api://workspaces/${input.workspaceId}/ingestions`,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ingestion: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        sourceName: input.sourceName,
        contentType: input.contentType,
        sourceLabel,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    };
  }

  const ExternalMultipartFieldsSchema = z.object({
    sourceName: z.string().min(1).max(200),
    idempotencyKey: z.string().min(1).max(512).optional(),
    contentType: z.string().min(1).optional(),
    titleHint: z.string().min(1).optional(),
    topic: z.string().min(1).optional(),
    sourceLabel: z.string().min(1).optional(),
    metadata: z.string().optional(),
  });

  function writeSse(res: import('node:http').ServerResponse, event: string, data: unknown) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function normalizeAskText(value: string): string {
    return value.normalize('NFKC').toLowerCase();
  }

  function askTokens(question: string): string[] {
    return [...new Set(normalizeAskText(question).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1))];
  }

  function scoreAskText(question: string, value: string): number {
    const normalized = normalizeAskText(value);
    const direct = normalized.includes(normalizeAskText(question).trim()) ? 3 : 0;
    return direct + askTokens(question).filter((token) => normalized.includes(token)).length;
  }

  function askSnippet(value: string, question: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= 180) return compact;
    const token = askTokens(question)[0];
    const index = token ? normalizeAskText(compact).indexOf(token) : -1;
    const start = index > 40 ? index - 40 : 0;
    return `${start > 0 ? '...' : ''}${compact.slice(start, start + 180)}${start + 180 < compact.length ? '...' : ''}`;
  }

  function trustRank(status: CandidateStatus): number {
    const order: Record<CandidateStatus, number> = {
      PUBLISHED: 0,
      SOURCE_VERIFIED: 1,
      NEEDS_CHECK: 2,
      NEEDS_APPROVAL: 3,
      AI_ORGANIZED: 4,
      CONFLICTED: 5,
    };
    return order[status];
  }

  function mergeAskCitations(left: AskCitation[], right: AskCitation[]): AskCitation[] {
    const seen = new Set<string>();
    const merged: AskCitation[] = [];
    for (const citation of [...left, ...right]) {
      const key = `${citation.sourceType}:${citation.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(citation);
    }
    return merged.slice(0, 6);
  }

  async function collectAskCitations(question: string): Promise<AskCitation[]> {
    const knowledge = await store.listKnowledge({ q: '', person: 'all', topic: 'all', tag: null, status: 'all', sort: 'uses' });
    const knowledgeCitations = knowledge.map((item) => ({
      citation: {
        id: `knowledge:${item.id}`,
        title: item.title,
        path: `${item.category}/${item.id}.md`,
        snippet: askSnippet(item.summary || item.contentMarkdown, question),
        trustStatus: 'PUBLISHED' as const,
        sourceType: 'knowledge' as const,
        documentId: item.documentId ?? item.id,
      },
      score: scoreAskText(question, `${item.title} ${item.summary} ${item.contentMarkdown} ${item.aiTags.join(' ')}`),
    }));

    const candidateStatuses = new Set<CandidateStatus>(['PUBLISHED', 'SOURCE_VERIFIED', 'NEEDS_CHECK']);
    const candidateCitations = (await store.listCandidates({}))
      .filter((candidate) => candidateStatuses.has(candidate.status))
      .map((candidate) => ({
        candidate,
        score: scoreAskText(question, `${candidate.title} ${candidate.summary} ${candidate.bodyMarkdown} ${candidate.provenance.label ?? ''} ${candidate.provenance.conversationQuote ?? ''}`),
      }))
      .filter(({ score }) => score > 0)
      .map(({ candidate, score }) => ({
        citation: {
          id: `candidate:${candidate.id}`,
          title: candidate.title,
          path: candidate.linkedDocId ? `document://${candidate.linkedDocId}` : candidate.provenance.ref,
          snippet: askSnippet(candidate.summary || candidate.bodyMarkdown || candidate.provenance.conversationQuote || '', question),
          trustStatus: candidate.status,
          sourceType: 'candidate' as const,
          ...(candidate.linkedDocId ? { documentId: candidate.linkedDocId } : {}),
        },
        score,
      }));

    return [...knowledgeCitations, ...candidateCitations]
      .filter(({ score }) => score > 0)
      .sort((a, b) => trustRank(a.citation.trustStatus) - trustRank(b.citation.trustStatus) || b.score - a.score)
      .map(({ citation }) => citation)
      .slice(0, 6);
  }

  function askFollowUp(question: string, reason: string): AskFollowUp {
    return { kind: 'knowledge_gap', target: 'conversation', question, reason };
  }

  function normalizeAskResponse(result: string | AskResponse, citations: AskCitation[]): AskResponse {
    const base: Partial<AskResponse> & { answer: string } = typeof result === 'string' ? { answer: result } : result;
    const mergedCitations = mergeAskCitations(base.citations ?? [], citations);
    const usedTrustLevels = [...new Set([...(base.usedTrustLevels ?? []), ...mergedCitations.map((citation) => citation.trustStatus)])];
    return AskResponseSchema.parse({
      ...base,
      citations: mergedCitations,
      usedTrustLevels,
      needsAttention: Boolean(base.needsAttention) || usedTrustLevels.includes('NEEDS_CHECK'),
    });
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

  app.get('/api/settings', async () => store.settings());

  app.patch('/api/settings', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canApprove(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const body = UpdateAppSettingsSchema.parse(request.body);
    const result = await store.updateSettings(body, me.role);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result.settings;
  });

  app.get('/api/admin/health', async () => {
    return { ok: true };
  });

  app.get('/api/admin/config', async () => store.runtimeConfig());

  app.patch('/api/admin/config', async (request) => {
    const body = RuntimeConfigPatchSchema.parse(request.body);
    if (body.policy !== undefined && body.policy !== null) {
      body.policy = PolicySchema.parse(body.policy);
    }
    return store.updateRuntimeConfig(body);
  });

  app.get('/api/admin/policy', async () => policyResponse());

  app.put('/api/admin/policy', async (request) => {
    const nextPolicy = request.body == null ? null : PolicySchema.parse(request.body);
    await store.updateRuntimeConfig({ policy: nextPolicy });
    return policyResponse();
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
    if (body.isSuperAdmin && !canManageOwners(me.role)) {
      return reply.code(403).send({ error: '슈퍼어드민 플래그는 소유자만 변경할 수 있습니다.' });
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
    if (!canManageOwners(me.role) && body.isSuperAdmin !== undefined && body.isSuperAdmin !== target?.isSuperAdmin) {
      return reply.code(403).send({ error: '슈퍼어드민 플래그는 소유자만 변경할 수 있습니다.' });
    }
    const result = await store.updateUserRole(id, body);
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

  // "연결 관계": this doc's extracted facts + other documents sharing the same entities.
  app.get('/api/documents/:id/connections', async (request) => {
    const { id } = request.params as { id: string };
    return store.documentConnections(id);
  });

  // Soft-delete a page to the trash (편집 권한 이상).
  app.delete('/api/documents/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const doc = await store.trashDocument(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  app.get('/api/trash', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    return store.listTrash();
  });

  app.post('/api/trash/:id/restore', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const doc = await store.restoreDocument(id);
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  app.delete('/api/trash/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const ok = await store.purgeDocument(id);
    if (!ok) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  app.post('/api/documents', async (request) => {
    const body = request.body as { title?: string; contentMarkdown?: string; parentId?: string | null };
    return store.createDocument({
      title: body.title ?? 'Untitled',
      contentMarkdown: body.contentMarkdown ?? '',
      parentId: body.parentId ?? null,
    });
  });

  app.post('/api/ingest', async (request, reply) => {
    if (!(await ensureIngestCapacity(reply))) return reply;
    const body = IngestRequestSchema.parse(request.body);
    const workspace = body.workspace ?? body.department;
    return store.ingest({
      title: body.title,
      contentMarkdown: body.contentMarkdown,
      parentId: body.parentId ?? null,
      ...(body.topic ? { topic: body.topic } : {}),
      ...(workspace ? { workspace } : {}),
      ...(body.sourceLabel ? { sourceLabel: body.sourceLabel } : {}),
    });
  });

  app.post('/api/ingest/file', async (request, reply) => {
    if (!(await ensureIngestCapacity(reply))) return reply;
    const input = await readIngestFileInput(request);
    if (!input.contentMarkdown.trim()) return reply.code(422).send({ error: 'Upload content is empty' });
    return store.ingest({
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
      sourceType: 'upload',
      sourceRef: `upload://${input.sourceLabel ?? input.title}`,
    });
  });

  app.post('/api/ingest/files', async (request, reply) => {
    if (!(await ensureIngestCapacity(reply))) return reply;
    const inputs = await readIngestFilesInput(request);
    const batch = await runIngestBatch(inputs, (input) => ({
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
      sourceType: 'upload' as const,
      sourceRef: `upload://${input.sourceLabel ?? input.title}`,
    }));
    const items = batch.map(({ item: input, result }) => ({
      fileName: input.sourceLabel ?? input.title,
      documentId: result.doc.id,
      jobId: result.job.id,
      replayed: result.replayed ?? false,
      doc: result.doc,
      job: result.job,
    }));
    return { items };
  });

  app.post('/api/workspaces/:workspaceId/ingestions', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { workspaceId } = request.params as { workspaceId: string };

    // Shed load before touching the (potentially large, multi-file) request body: backlog 503 first so
    // a busy-queue rejection does not burn the caller's rate-limit budget, then the per-principal limit.
    if (!(await ensureIngestCapacity(reply))) return reply;
    if (!(await enforceExternalRateLimit(reply, { userId: me.id, workspaceId }))) return reply;

    if (request.isMultipart()) {
      const { files, fields } = await collectUploadParts(request, { maxFiles: INGEST_MAX_FILES });
      if (files.length === 0) return reply.code(400).send({ error: 'No file uploaded' });
      assertNonEmptyUploadFiles(files);
      const parsedFields = ExternalMultipartFieldsSchema.parse({
        ...fields,
        idempotencyKey: fields.idempotencyKey || undefined,
        contentType: fields.contentType || undefined,
        titleHint: fields.titleHint || undefined,
        topic: fields.topic || undefined,
        sourceLabel: fields.sourceLabel || undefined,
        metadata: fields.metadata || undefined,
      });

      const metadata = parseMetadata(parsedFields.metadata);
      const batch = await runIngestBatch(files, (file, index) => {
        const fileTitle = titleForFile(parsedFields.titleHint, file.fileName, files.length);
        // Disambiguate per file (by index) so same-named files in one batch get distinct idempotency
        // scopes — otherwise all but the first would be silently dropped as a "replay".
        const idempotencyKey = parsedFields.idempotencyKey ? `${parsedFields.idempotencyKey}:${index}:${file.fileName}` : undefined;
        return externalIngestInput({
          userId: me.id,
          workspaceId,
          sourceName: parsedFields.sourceName,
          contentMarkdown: file.contentMarkdown,
          contentType: parsedFields.contentType ?? file.contentType,
          title: fileTitle,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(parsedFields.sourceLabel ? { sourceLabel: parsedFields.sourceLabel } : {}),
          ...(parsedFields.topic ? { topic: parsedFields.topic } : {}),
          ...(metadata ? { metadata } : {}),
        });
      });
      const items = batch.map(({ item: file, result }) => ({
        fileName: file.fileName,
        ...externalIngestResponse(result),
      }));
      return { items };
    }

    const body = ExternalIngestionRequestSchema.parse(request.body);
    if (!body.rawPayload.text.trim()) return reply.code(422).send({ error: 'Ingestion content is empty' });
    const result = await store.ingest(
      externalIngestInput({
        userId: me.id,
        workspaceId,
        sourceName: body.sourceName,
        contentMarkdown: body.rawPayload.text,
        contentType: body.contentType,
        title: body.titleHint?.trim() || body.sourceName,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
        ...(body.sourceLabel ? { sourceLabel: body.sourceLabel } : {}),
        ...(body.topic ? { topic: body.topic } : {}),
        ...(body.metadata ? { metadata: body.metadata } : {}),
      }),
    );
    return externalIngestResponse(result);
  });

  app.get('/api/reviews', async () => store.reviews());

  app.post('/api/conversation-ingest', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const body = ConversationIngestRequestSchema.parse(request.body);
    const createdAt = new Date().toISOString();
    const sync = (request.query as { sync?: string }).sync === '1';

    if (conversationQueue && !sync) {
      const job = await conversationQueue.add('INGEST_CONVERSATION', body);
      return { jobId: String(job.id), type: 'INGEST_CONVERSATION' as const, candidates: [], createdAt };
    }

    const resolved = body.transcript?.trim()
      ? {
          transcript: body.transcript,
          sourceRef: body.ref ?? 'conversation://manual',
          sourceLabel: body.source === 'manual' ? 'Manual conversation' : body.source,
        }
      : body.ref && body.source !== 'manual'
        ? await getConnector(body.source === 'slack' ? 'slack' : 'meeting')
            .fetch(body.ref)
            .then((fetched) => ({
              transcript: fetched.text,
              sourceRef: fetched.ref.ref,
              sourceLabel: fetched.ref.title ?? fetched.provenance.label ?? body.source,
            }))
        : undefined;
    if (!resolved) return reply.code(422).send({ error: 'Conversation transcript or supported ref is required' });

    const drafts = extractConversationCandidates(resolved.transcript, {
      sourceRef: resolved.sourceRef,
      sourceLabel: resolved.sourceLabel,
      ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
    });
    const candidates = [];
    for (const draft of drafts) {
      candidates.push(await store.createCandidate(draft));
    }
    return { jobId: `conversation-sync-${Date.now()}`, type: 'INGEST_CONVERSATION' as const, candidates, createdAt };
  });

  app.get('/api/candidates', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    return store.listCandidates(KnowledgeCandidateListQuerySchema.parse(request.query));
  });

  app.post('/api/candidates', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const body = CreateKnowledgeCandidateSchema.parse(request.body);
    return store.createCandidate(body);
  });

  app.get('/api/candidates/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const candidate = await store.getCandidate(id);
    if (!candidate) return reply.code(404).send({ error: 'Not found' });
    return candidate;
  });

  app.patch('/api/candidates/:id', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const body = UpdateKnowledgeCandidateStatusSchema.parse(request.body);
    const candidate = await store.getCandidate(id);
    if (!candidate) return reply.code(404).send({ error: 'Not found' });
    if (body.status === 'SOURCE_VERIFIED' || body.provenanceNeedsSource === false || body.removeRiskFactor === 'no_source') {
      if (!body.linkedDocId) return reply.code(400).send({ error: 'linkedDocId is required to verify a source' });
      const linkedDoc = await store.getDocument(body.linkedDocId);
      if (!linkedDoc) return reply.code(400).send({ error: 'Linked source document not found' });
      const sourceWorkspaceId = linkedDoc.ingestion?.workspaceId;
      if (candidate.workspaceId && sourceWorkspaceId && candidate.workspaceId !== sourceWorkspaceId) {
        return reply.code(400).send({ error: 'Linked source document belongs to a different workspace' });
      }
    }
    if (body.status === 'PUBLISHED') {
      const route = routeCandidate(candidate, await currentRuntimePolicy(), { role: me.role });
      if (route.action === 'reject') return reply.code(409).send({ error: 'Conflicted candidates cannot be published' });
      if (route.action === 'needs_source') return reply.code(409).send({ error: 'Candidate needs a verified source before publishing' });
      if (route.action === 'needs_approval' && !route.canApprove) {
        return reply.code(403).send({ error: `Approval requires one of: ${route.approverRoles.join(', ')}` });
      }
    }
    const result = await store.updateCandidateStatus(id, body);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result.candidate;
  });

  app.get('/api/candidate-review-routes', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canReview(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const policy = await currentRuntimePolicy();
    const candidates = await store.listCandidates(KnowledgeCandidateListQuerySchema.parse(request.query));
    return candidates
      .filter((candidate) => candidate.status !== 'PUBLISHED')
      .map((candidate) => ({ candidate, route: routeCandidate(candidate, policy, { role: me.role }) }));
  });

  app.post('/api/candidates/:id/route', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canReview(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const body = ResolveCandidateRouteBodySchema.parse(request.body);
    const candidate = await store.getCandidate(id);
    if (!candidate) return reply.code(404).send({ error: 'Not found' });
    const route = routeCandidate(candidate, await currentRuntimePolicy(), { role: me.role });

    if (body.action === 'auto_publish') {
      if (route.action !== 'auto_publish') return reply.code(409).send({ error: `Candidate route is ${route.action}` });
      const result = await store.updateCandidateStatus(id, { status: 'PUBLISHED' });
      if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
      return result.candidate;
    }

    if (body.action === 'approve') {
      if (route.action === 'reject') return reply.code(409).send({ error: 'Conflicted candidates cannot be approved' });
      if (route.action === 'needs_source') return reply.code(409).send({ error: 'Candidate needs a verified source before approval' });
      if (!route.canApprove) return reply.code(403).send({ error: `Approval requires one of: ${route.approverRoles.join(', ')}` });
      const result = await store.updateCandidateStatus(id, { status: 'PUBLISHED' });
      if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
      return result.candidate;
    }

    if (body.action === 'request_source') {
      const result = await store.updateCandidateStatus(id, { status: 'NEEDS_CHECK' });
      if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
      return result.candidate;
    }

    const result = await store.updateCandidateStatus(id, { status: 'CONFLICTED' });
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return result.candidate;
  });

  app.get('/api/knowledge', async (request) => store.listKnowledge(KnowledgeQuerySchema.parse(request.query)));

  app.get('/api/knowledge-map', async (request) => {
    const query = request.query as { typedRelations?: string };
    const categories = await store.treeCategories();
    return knowledgeItemsToLinkGraph(
      categories.flatMap((category) => category.items),
      { includeTypedRelations: query.typedRelations === '1' },
    );
  });

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

  // Reassign a page's topic (헤더 주제 변경): empty/blank → 미분류 (편집 권한 이상).
  app.patch('/api/knowledge/:id/category', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { id } = request.params as { id: string };
    const { category } = request.body as { category?: string };
    const item = await store.setKnowledgeCategory(id, category ?? '');
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

  // Remove a category by name (tree right-click): pages drop to 미분류 (편집 권한 이상).
  app.post('/api/topics/declassify', async (request, reply) => {
    const me = await currentUser(request);
    if (!me || !canEdit(me.role)) return reply.code(403).send({ error: 'Forbidden' });
    const { name } = request.body as { name?: string };
    const result = await store.declassifyCategory((name ?? '').trim());
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

  app.post('/api/ask', async (request, reply) => {
    const me = await currentUser(request);
    if (!me) return reply.code(401).send({ error: 'Unauthorized' });
    if (!discoveryAsk) return reply.code(503).send({ error: 'Discovery agent is not configured' });
    const body = z.object({ question: z.string().min(1) }).parse(request.body);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    try {
      const citations = await collectAskCitations(body.question);
      const answer = normalizeAskResponse(await discoveryAsk({ question: body.question, user: me }), citations);
      writeSse(res, 'answer', answer);
      writeSse(res, 'completed', { ok: true });
    } catch (error) {
      writeSse(res, 'failed', {
        error: error instanceof Error ? error.message : String(error),
        followUp: askFollowUp(body.question, 'Discovery answer failed before it could return cited evidence.'),
      });
    } finally {
      res.end();
    }
  });

  app.post('/api/documents/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const me = await currentUser(request);
    {
      const doc = await store.getDocument(id);
      if (!doc) return reply.code(404).send({ error: 'Not found' });
      try {
        const wkfDoc = doc.contentMarkdown.trimStart().startsWith('---')
          ? parseWkf(doc.contentMarkdown)
          : { frontmatter: { type: 'ENTITY', title: doc.title, tags: [] }, body: doc.contentMarkdown };
        enforcePolicy('review', wkfDoc, await currentRuntimePolicy(), me ? { role: me.role } : {});
      } catch (error) {
        if (error instanceof PolicyError) return reply.code(403).send({ error: error.message });
        throw error;
      }
    }
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
    const input = await readAgentPreviewInput(request);
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

    const liveQueues = [
      ...(jobQueue && jobEvents ? [{ queue: jobQueue, events: jobEvents }] : []),
      ...(conversationQueue && conversationJobEvents ? [{ queue: conversationQueue, events: conversationJobEvents }] : []),
    ];
    if (liveQueues.length === 0) {
      // No live queue (e.g. in-memory/test): emit a single stub event and close.
      send('step', { jobId: id, status: 'stub' });
      res.end();
      return;
    }

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
      for (const { events } of liveQueues) {
        events.off('progress', onProgress);
        events.off('completed', onCompleted);
        events.off('failed', onFailed);
      }
      request.raw.off('close', cleanup);
    }

    function closeStream() {
      if (closed) return;
      closed = true;
      cleanup();
      res.end();
    }

    for (const { events } of liveQueues) {
      events.on('progress', onProgress);
      events.on('completed', onCompleted);
      events.on('failed', onFailed);
    }
    request.raw.on('close', cleanup);

    let job: Awaited<ReturnType<Queue['getJob']>> | undefined;
    for (const { queue } of liveQueues) {
      const candidate = await queue.getJob(id);
      if (candidate) {
        job = candidate;
        break;
      }
    }
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
