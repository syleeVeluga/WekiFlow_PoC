import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { DepartmentSchema } from '@wf/shared';
import { defaultPolicy } from '@wekiflow/wkf';
import { buildServer } from './server.js';
import { InMemoryWekiFlowStore } from './store.js';

async function login(app: ReturnType<typeof buildServer>, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return res.json().token as string;
}

function multipartPayload(input: {
  fields?: Record<string, string>;
  file?: { name: string; content: string; contentType?: string };
  files?: Array<{ name: string; content: string; contentType?: string }>;
}) {
  const boundary = `----wf-${Math.random().toString(16).slice(2)}`;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  const files = input.files ?? (input.file ? [input.file] : []);
  for (const file of files) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType ?? 'text/plain'}\r\n\r\n${file.content}\r\n`,
    );
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(chunks.join(''), 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('@wf/api routes', () => {
  it('skips review by default and uses settings to re-enable approval gates', async () => {
    const store = new InMemoryWekiFlowStore();
    const app = buildServer({ store });

    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({ reviewApprovalEnabled: false });

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: {
        title: 'Manual policy',
        contentMarkdown: '# New policy',
        topic: '복지',
        workspace: '총무팀',
        sourceLabel: '사내 공지',
      },
    });
    expect(ingest.statusCode).toBe(200);
    const ingestBody = ingest.json();
    expect(ingestBody.doc.status).toBe('PUBLISHED');
    expect(ingestBody.job.type).toBe('INGEST');
    expect(ingestBody.doc.sourceRefs[0].note).toContain('topic=복지');
    expect(ingestBody.doc.sourceRefs[0].note).toContain('workspace=총무팀');
    expect(ingestBody.doc.sourceRefs[0].note).toContain('source=사내 공지');

    const reviews = await app.inject({ method: 'GET', url: '/api/reviews' });
    expect(reviews.json()).toHaveLength(0);
    expect(store.graphQueue.jobs).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'EXTRACT_TRIPLETS', documentId: ingestBody.doc.id })]),
    );

    const denied = await app.inject({
      method: 'POST',
      url: `/api/documents/${ingestBody.doc.id}/approve`,
    });
    expect(denied.statusCode).toBe(403);

    const rejectDenied = await app.inject({
      method: 'POST',
      url: `/api/documents/${ingestBody.doc.id}/reject`,
    });
    expect(rejectDenied.statusCode).toBe(403);

    // Auto-publishing materializes a KnowledgeItem so the doc surfaces in the KB + Document Tree under
    // its assigned topic (the core "knowledge accumulates in the tree" loop).
    const knowledge = await app.inject({ method: 'GET', url: `/api/knowledge/${ingestBody.doc.id}` });
    expect(knowledge.statusCode).toBe(200);
    expect(knowledge.json()).toMatchObject({ id: ingestBody.doc.id, title: 'Manual policy', category: '복지' });

    const treeCategories = await app.inject({ method: 'GET', url: '/api/tree/categories' });
    const welfare = treeCategories.json().find((category: { name: string }) => category.name === '복지');
    expect(welfare).toBeTruthy();
    expect(welfare.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ingestBody.doc.id })]),
    );

    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const enabled = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reviewApprovalEnabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ reviewApprovalEnabled: true });

    const gatedIngest = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'Gated policy', contentMarkdown: '# Needs approval', topic: '복지' },
    });
    expect(gatedIngest.statusCode).toBe(200);
    const gatedBody = gatedIngest.json();
    expect(gatedBody.doc.status).toBe('REVIEW');
    expect((await app.inject({ method: 'GET', url: '/api/reviews' })).json()).toHaveLength(1);

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reviewApprovalEnabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ reviewApprovalEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/api/reviews' })).json()).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/api/documents/${gatedBody.doc.id}` })).json().status).toBe('PUBLISHED');
    expect(store.graphQueue.jobs).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'EXTRACT_TRIPLETS', documentId: gatedBody.doc.id })]),
    );

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reviewApprovalEnabled: true },
    });
    const approvalIngest = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: 'Approval policy', contentMarkdown: '# Approve me', topic: '복지' },
    });
    expect(approvalIngest.statusCode).toBe(200);
    const approvalBody = approvalIngest.json();
    expect(approvalBody.doc.status).toBe('REVIEW');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${approvalBody.doc.id}/approve`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().doc.status).toBe('PUBLISHED');
    expect(approved.json().job.type).toBe('EXTRACT_TRIPLETS');

    await app.close();
  });

  it('ingests uploaded md/txt files and rejects unsupported or empty uploads', async () => {
    const app = buildServer();
    const upload = multipartPayload({
      fields: { title: 'Uploaded policy', topic: '복지', department: DepartmentSchema.options[0]!, sourceLabel: 'policy.md' },
      file: { name: 'policy.md', content: '# Upload\n\nPolicy body', contentType: 'text/markdown' },
    });

    const accepted = await app.inject({ method: 'POST', url: '/api/ingest/file', ...upload });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().doc.status).toBe('PUBLISHED');
    expect(accepted.json().doc.contentMarkdown).toContain('Policy body');
    expect(accepted.json().doc.sourceRefs[0].note).toContain('source=policy.md');

    const unsupported = multipartPayload({
      fields: { title: 'Future parser', topic: '복지', department: DepartmentSchema.options[0]! },
      file: { name: 'deck.docx', content: 'not parsed yet' },
    });
    expect((await app.inject({ method: 'POST', url: '/api/ingest/file', ...unsupported })).statusCode).toBe(415);

    const empty = multipartPayload({
      fields: { title: 'Empty text', topic: '복지', department: DepartmentSchema.options[0]! },
      file: { name: 'empty.txt', content: '   \n' },
    });
    expect((await app.inject({ method: 'POST', url: '/api/ingest/file', ...empty })).statusCode).toBe(422);

    await app.close();
  });

  it('ingests multiple uploaded files as separate documents and rejects invalid batches atomically', async () => {
    const store = new InMemoryWekiFlowStore();
    const app = buildServer({ store });

    const upload = multipartPayload({
      fields: { topic: '복지', department: DepartmentSchema.options[0]! },
      files: [
        { name: 'policy-a.md', content: '# A\n\nBody A', contentType: 'text/markdown' },
        { name: 'policy-b.txt', content: 'Body B', contentType: 'text/plain' },
      ],
    });
    const accepted = await app.inject({ method: 'POST', url: '/api/ingest/files', ...upload });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().items).toHaveLength(2);
    expect(accepted.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'policy-a.md' }),
        expect.objectContaining({ fileName: 'policy-b.txt' }),
      ]),
    );
    expect(accepted.json().items[0].doc.status).toBe('PUBLISHED');

    const beforeDocuments = store.documents.size;
    const beforeJobs = store.mainQueue.jobs.length;
    const invalid = multipartPayload({
      files: [
        { name: 'valid.md', content: '# Valid' },
        { name: 'deck.docx', content: 'not parsed yet' },
      ],
    });
    expect((await app.inject({ method: 'POST', url: '/api/ingest/files', ...invalid })).statusCode).toBe(415);
    expect(store.documents.size).toBe(beforeDocuments);
    expect(store.mainQueue.jobs).toHaveLength(beforeJobs);

    await app.close();
  });

  it('accepts external JSON ingestions with metadata and replays idempotent requests', async () => {
    const store = new InMemoryWekiFlowStore();
    const app = buildServer({ store });
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-default/ingestions',
      payload: {
        sourceName: 'my-agent',
        rawPayload: { text: '# Denied' },
      },
    });
    expect(anonymous.statusCode).toBe(403);

    const payload = {
      sourceName: 'my-agent',
      idempotencyKey: 'unique-key-for-this-doc',
      contentType: 'text/markdown',
      titleHint: 'Document Title',
      metadata: { sentFrom: 'ci', repository: 'policy-repo' },
      rawPayload: { text: '# Heading\n\nContent here' },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-default/ingestions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ replayed: false });
    const jobCount = store.mainQueue.jobs.length;

    const doc = await app.inject({ method: 'GET', url: `/api/documents/${first.json().documentId}` });
    expect(doc.statusCode).toBe(200);
    expect(doc.json().sourceRefs[0]).toMatchObject({ type: 'api' });
    expect(doc.json().ingestion).toMatchObject({
      workspaceId: 'workspace-default',
      sourceName: 'my-agent',
      idempotencyKey: 'unique-key-for-this-doc',
      contentType: 'text/markdown',
      metadata: { sentFrom: 'ci', repository: 'policy-repo' },
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-default/ingestions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ documentId: first.json().documentId, replayed: true });
    expect(store.mainQueue.jobs).toHaveLength(jobCount);

    await app.close();
  });

  it('rate-limits external ingestions and guards queue backlog', async () => {
    const rateLimited = buildServer({ externalRateLimit: { max: 1, windowMs: 60_000 } });
    const ownerToken = await login(rateLimited, 'admin01@veluga.io', 'admin01@veluga.io');
    const auth = { authorization: `Bearer ${ownerToken}` };
    const payload = (key: string) => ({
      sourceName: 'limited-agent',
      idempotencyKey: key,
      rawPayload: { text: `# ${key}` },
    });

    expect((await rateLimited.inject({ method: 'POST', url: '/api/workspaces/workspace-default/ingestions', headers: auth, payload: payload('one') })).statusCode).toBe(200);
    const limited = await rateLimited.inject({ method: 'POST', url: '/api/workspaces/workspace-default/ingestions', headers: auth, payload: payload('two') });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    await rateLimited.close();

    const busy = buildServer({
      jobQueue: {
        async getJobCounts() {
          return { waiting: 1_000, delayed: 0, prioritized: 0, active: 0 };
        },
      } as never,
    });
    const busyToken = await login(busy, 'admin01@veluga.io', 'admin01@veluga.io');
    const rejected = await busy.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-default/ingestions',
      headers: { authorization: `Bearer ${busyToken}` },
      payload: { sourceName: 'backlog-agent', rawPayload: { text: '# Queue busy' } },
    });
    expect(rejected.statusCode).toBe(503);
    expect(rejected.headers['retry-after']).toBe(String(60));
    await busy.close();
  });

  it('emits the current job state when SSE starts after completion', async () => {
    const app = buildServer({
      jobEvents: new EventEmitter() as never,
      jobQueue: {
        async getJob() {
          return {
            async getState() {
              return 'completed';
            },
            returnvalue: { documentId: 'doc-2', status: 'REVIEW' },
            progress: 100,
          };
        },
      } as never,
    });

    const stream = await app.inject({ method: 'GET', url: '/api/jobs/main-1/stream' });

    expect(stream.statusCode).toBe(200);
    expect(stream.payload).toContain('event: completed');
    expect(stream.payload).toContain('"jobId":"main-1"');

    await app.close();
  });

  it('streams Discovery Q&A answers through /api/ask', async () => {
    const app = buildServer({ discoveryAsk: async ({ question }) => `answer:${question}` });
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');

    const denied = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'leave?' } });
    expect(denied.statusCode).toBe(401);

    const streamed = await app.inject({
      method: 'POST',
      url: '/api/ask',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { question: 'leave?' },
    });

    expect(streamed.statusCode).toBe(200);
    expect(streamed.payload).toContain('event: answer');
    expect(streamed.payload).toContain('answer:leave?');
    expect(streamed.payload).toContain('event: completed');
    await app.close();
  });

  it('serves first-class knowledge candidates and enforces status transitions', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');

    const denied = await app.inject({
      method: 'POST',
      url: '/api/candidates',
      payload: {
        title: 'Unauthorized candidate',
        provenance: { kind: 'manual', ref: 'manual://1' },
      },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/candidates',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        title: '회의 기반 승인 정책',
        summary: '대화에서 나온 정책 후보',
        provenance: { kind: 'conversation', ref: 'chat://1', speaker: '이지수' },
        riskFactors: ['official_answer', 'no_source'],
        workspaceId: 'workspace-default',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      status: 'NEEDS_CHECK',
      provenance: { kind: 'conversation', needsSource: true },
    });

    const filtered = await app.inject({ method: 'GET', url: '/api/candidates?riskFactor=no_source&provenanceKind=conversation' });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json().id })]));

    const detail = await app.inject({ method: 'GET', url: `/api/candidates/${created.json().id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().title).toBe('회의 기반 승인 정책');

    const advanced = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${created.json().id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: 'SOURCE_VERIFIED' },
    });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().status).toBe('SOURCE_VERIFIED');

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/candidates/${created.json().id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: 'AI_ORGANIZED' },
    });
    expect(invalid.statusCode).toBe(400);

    await app.close();
  });

  it('creates needs-check candidates from conversation ingest inputs', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');

    const denied = await app.inject({
      method: 'POST',
      url: '/api/conversation-ingest',
      payload: { source: 'manual', transcript: 'Jin: Decision: pricing answers require approval.' },
    });
    expect(denied.statusCode).toBe(403);

    const manual = await app.inject({
      method: 'POST',
      url: '/api/conversation-ingest',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        source: 'manual',
        transcript: 'Jin: Decision: pricing answers require approval.',
        workspaceId: 'workspace-default',
      },
    });
    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({ type: 'INGEST_CONVERSATION' });
    expect(manual.json().candidates[0]).toMatchObject({
      status: 'NEEDS_CHECK',
      riskFactors: expect.arrayContaining(['pricing', 'no_source']),
      provenance: {
        kind: 'conversation',
        speaker: 'Jin',
        createdFromConversation: true,
        needsSource: true,
      },
      workspaceId: 'workspace-default',
    });

    const meeting = await app.inject({
      method: 'POST',
      url: '/api/conversation-ingest',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { source: 'meeting', ref: 'meeting://transcripts/product-sync-2026-06-20' },
    });
    expect(meeting.statusCode).toBe(200);
    expect(meeting.json().candidates.length).toBeGreaterThan(0);
    expect(meeting.json().candidates[0].provenance.kind).toBe('conversation');

    await app.close();
  });

  it('runs owner-only agent preview and streams persisted steps', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const reviewerToken = await login(app, 'park.minji@veluga.io', 'park.minji@veluga.io');

    const denied = await app.inject({
      method: 'POST',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${reviewerToken}` },
      payload: { message: '# Test' },
    });
    expect(denied.statusCode).toBe(403);

    const started = await app.inject({
      method: 'POST',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'Preview test', message: '# Test' },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ jobId: 'preview-1', documentId: 'preview-doc-1' });

    const list = await app.inject({
      method: 'GET',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    // The result carries the original (merged-against) text so the client diff base is correct on
    // replay/reload, not just for the session that started the run.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/agent-preview/${started.json().jobId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().result.originalMarkdown).toBe('# Test');

    const committed = await app.inject({
      method: 'POST',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'Committed preview', message: '# Commit me', commit: true },
    });
    expect(committed.statusCode).toBe(200);

    const committedDetail = await app.inject({
      method: 'GET',
      url: `/api/agent-preview/${committed.json().jobId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(committedDetail.statusCode).toBe(200);
    expect(committedDetail.json().result.committed).toBe(true);

    const tree = await app.inject({ method: 'GET', url: '/api/tree' });
    expect(tree.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: committed.json().documentId, status: 'PUBLISHED' })]));

    const layer1Reviews = await app.inject({ method: 'GET', url: '/api/reviews' });
    expect(layer1Reviews.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: committed.json().documentId })]));

    const badStream = await app.inject({
      method: 'GET',
      url: `/api/agent-preview/${started.json().jobId}/stream?token=bad-token`,
    });
    expect(badStream.statusCode).toBe(403);

    const stream = await app.inject({
      method: 'GET',
      url: `/api/agent-preview/${started.json().jobId}/stream?token=${ownerToken}`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.payload).toContain('event: step');
    expect(stream.payload).toContain('event: completed');

    await app.close();
  });

  it('rejects malformed agent preview requests with 400', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');

    const emptyMessage = await app.inject({
      method: 'POST',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { message: '' },
    });
    expect(emptyMessage.statusCode).toBe(400);

    const missingMessage = await app.inject({
      method: 'POST',
      url: '/api/agent-preview',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'No body' },
    });
    expect(missingMessage.statusCode).toBe(400);

    await app.close();
  });

  it('serves wiki knowledge, topics, reviews, and multi-source workflow routes', async () => {
    const app = buildServer();

    const knowledge = await app.inject({ method: 'GET', url: '/api/knowledge' });
    expect(knowledge.statusCode).toBe(200);
    expect(knowledge.json()).toHaveLength(88);

    const patchTarget = knowledge.json()[0];
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${patchTarget.id}`,
      payload: { contentMarkdown: `${patchTarget.contentMarkdown}\n\nsmoke update` },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().modCount).toBe(patchTarget.modCount + 1);

    const reviews = await app.inject({ method: 'GET', url: '/api/reviews/rich' });
    expect(reviews.statusCode).toBe(200);
    expect(reviews.json().length).toBeGreaterThan(0);

    const denied = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reviews.json()[0].id}/approve`,
    });
    expect(denied.statusCode).toBe(403);

    const multi = await app.inject({ method: 'GET', url: '/api/multi-source' });
    expect(multi.statusCode).toBe(200);
    expect(multi.json().length).toBeGreaterThan(0);

    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const conflict = multi.json().find((item: { multiSourceType: string }) => item.multiSourceType === 'C');
    const conflictResult = await app.inject({
      method: 'POST',
      url: `/api/multi-source/${conflict.id}/resolve`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { targetIds: conflict.targets.map((target: { id: string }) => target.id), content: 'manual decision' },
    });
    expect(conflictResult.statusCode).toBe(409);

    const topics = await app.inject({ method: 'GET', url: '/api/topics' });
    expect(topics.statusCode).toBe(200);
    expect(topics.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: '미분류', isUnclassified: true })]));
    const treeCategories = await app.inject({ method: 'GET', url: '/api/tree/categories' });
    expect(treeCategories.statusCode).toBe(200);
    expect(treeCategories.json()).toEqual(expect.arrayContaining([expect.objectContaining({ name: '미분류' })]));
    const systemTopic = topics.json().find((topic: { source: string }) => topic.source === 'system');
    const deleteSystem = await app.inject({ method: 'DELETE', url: `/api/topics/${systemTopic.id}` });
    expect(deleteSystem.statusCode).toBe(400);

    const createdTopic = await app.inject({ method: 'POST', url: '/api/topics', payload: { name: 'temporary topic' } });
    expect(createdTopic.statusCode).toBe(200);
    const deletedTopic = await app.inject({ method: 'DELETE', url: `/api/topics/${createdTopic.json().id}` });
    expect(deletedTopic.statusCode).toBe(200);
    expect(deletedTopic.json().ok).toBe(true);

    await app.close();
  });

  it('reassigns a page topic via PATCH /knowledge/:id/category and defaults blank to 미분류', async () => {
    const app = buildServer();

    const target = (await app.inject({ method: 'GET', url: '/api/knowledge' })).json()[0];

    // 익명/뷰어는 분류 변경 불가 (편집 권한 이상).
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${target.id}/category`,
      payload: { category: '복지' },
    });
    expect(denied.statusCode).toBe(403);

    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const auth = { authorization: `Bearer ${ownerToken}` };

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${target.id}/category`,
      headers: auth,
      payload: { category: '복지' },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ id: target.id, category: '복지' });

    // 빈 값은 미분류로 정규화.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${target.id}/category`,
      headers: auth,
      payload: { category: '   ' },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().category).toBe('미분류');

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/knowledge/does-not-exist/category',
      headers: auth,
      payload: { category: '복지' },
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it('authenticates, gates user management, and separates 검토(review) from 승인(approve)', async () => {
    const app = buildServer();

    // 익명은 사용자 목록 접근 불가, 잘못된 비밀번호는 401.
    expect((await app.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(403);
    const badLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin01@veluga.io', password: 'nope' } });
    expect(badLogin.statusCode).toBe(401);

    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const auth = { authorization: `Bearer ${ownerToken}` };

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe('OWNER');

    const users = await app.inject({ method: 'GET', url: '/api/users', headers: auth });
    expect(users.statusCode).toBe(200);
    const ownerRow = users.json().find((user: { role: string }) => user.role === 'OWNER');

    // 본인 삭제 불가(400), 마지막 소유자 강등 불가(400).
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${ownerRow.id}`, headers: auth })).statusCode).toBe(400);
    const demote = await app.inject({ method: 'PATCH', url: `/api/users/${ownerRow.id}`, headers: auth, payload: { role: 'VIEWER' } });
    expect(demote.statusCode).toBe(400);

    // 사용자 생성: 비밀번호=이메일로 바로 로그인 가능.
    const created = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { email: 'new.user@veluga.io', name: '신규', role: 'EDITOR' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().role).toBe('EDITOR');
    expect(await login(app, 'new.user@veluga.io', 'new.user@veluga.io')).toBeTruthy();

    // 검토(REVIEWER)는 반려 200 / 최종 승인 403, 사용자 관리 403.
    const reviewerToken = await login(app, 'park.minji@veluga.io', 'park.minji@veluga.io');
    const reviewerAuth = { authorization: `Bearer ${reviewerToken}` };
    const reviewId = (await app.inject({ method: 'GET', url: '/api/reviews/rich' })).json()[0].id;
    expect((await app.inject({ method: 'POST', url: `/api/reviews/${reviewId}/approve`, headers: reviewerAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/reviews/${reviewId}/reject`, headers: reviewerAuth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: reviewerAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/settings', headers: reviewerAuth, payload: { reviewApprovalEnabled: true } })).statusCode).toBe(403);

    await app.close();
  });

  it('gates /api/admin with isSuperAdmin and lets only owners change that flag', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const approverToken = await login(app, 'lee.jisoo@veluga.io', 'lee.jisoo@veluga.io');
    const reviewerToken = await login(app, 'park.minji@veluga.io', 'park.minji@veluga.io');

    expect((await app.inject({ method: 'GET', url: '/api/admin/health' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/health', headers: { authorization: `Bearer ${reviewerToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/health', headers: { authorization: `Bearer ${ownerToken}` } })).statusCode).toBe(200);

    const forbiddenGrant = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${approverToken}` },
      payload: { email: 'blocked.super@veluga.io', name: 'Blocked', role: 'EDITOR', isSuperAdmin: true },
    });
    expect(forbiddenGrant.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'dev.super@veluga.io', name: 'Dev Super', role: 'EDITOR', isSuperAdmin: true },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ role: 'EDITOR', isSuperAdmin: true });

    const superToken = await login(app, 'dev.super@veluga.io', 'dev.super@veluga.io');
    expect((await app.inject({ method: 'GET', url: '/api/admin/health', headers: { authorization: `Bearer ${superToken}` } })).statusCode).toBe(200);

    const forbiddenRevoke = await app.inject({
      method: 'PATCH',
      url: `/api/users/${created.json().id}`,
      headers: { authorization: `Bearer ${approverToken}` },
      payload: { role: 'EDITOR', isSuperAdmin: false },
    });
    expect(forbiddenRevoke.statusCode).toBe(403);

    const revoked = await app.inject({
      method: 'PATCH',
      url: `/api/users/${created.json().id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'EDITOR', isSuperAdmin: false },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ role: 'EDITOR', isSuperAdmin: false });

    await app.close();
  });

  it('serves and patches runtime config under the admin gate', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const reviewerToken = await login(app, 'park.minji@veluga.io', 'park.minji@veluga.io');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/config',
      headers: { authorization: `Bearer ${reviewerToken}` },
    });
    expect(denied.statusCode).toBe(403);

    const before = await app.inject({
      method: 'GET',
      url: '/api/admin/config',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().effective.agentParams.vectorK).toBe(8);
    expect(before.json().defaults.models.agentModel).toBeTruthy();

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { agentParams: { vectorK: 12 }, models: { agentModel: 'gpt-runtime' } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().overrides.agentParams.vectorK).toBe(12);
    expect(patched.json().effective.models.agentModel).toBe('gpt-runtime');

    const restored = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { agentParams: { vectorK: null }, models: { agentModel: null } },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().overrides.agentParams.vectorK).toBeUndefined();
    expect(restored.json().effective.agentParams.vectorK).toBe(8);
    expect(restored.json().effective.models.agentModel).toBe(restored.json().defaults.models.agentModel);

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { agentParams: { vectorK: 0 } },
    });
    expect(invalid.statusCode).toBe(400);

    const policyBefore = await app.inject({
      method: 'GET',
      url: '/api/admin/policy',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(policyBefore.statusCode).toBe(200);
    expect(policyBefore.json().effective.review.approver_roles).toEqual(['OWNER', 'APPROVER']);

    const policyPatch = await app.inject({
      method: 'PUT',
      url: '/api/admin/policy',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...defaultPolicy, review: { ...defaultPolicy.review, approver_roles: ['OWNER'], overrides: {} } },
    });
    expect(policyPatch.statusCode).toBe(200);
    expect(policyPatch.json().overrides.review.approver_roles).toEqual(['OWNER']);

    const invalidPolicy = await app.inject({
      method: 'PUT',
      url: '/api/admin/policy',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...defaultPolicy, review: { ...defaultPolicy.review, approver_roles: ['ADMIN'], overrides: {} } },
    });
    expect(invalidPolicy.statusCode).toBe(400);

    const policyRestored = await app.inject({
      method: 'PUT',
      url: '/api/admin/policy',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(policyRestored.statusCode).toBe(200);
    expect(policyRestored.json().overrides).toBeNull();

    await app.close();
  });

  it('applies policy review role overrides on document approval', async () => {
    const ownerOnlyRegulationPolicy = {
      ...defaultPolicy,
      review: { ...defaultPolicy.review, overrides: { REGULATION: ['OWNER'] } },
    };
    const app = buildServer({ reviewPolicy: ownerOnlyRegulationPolicy });
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const approverToken = await login(app, 'lee.jisoo@veluga.io', 'lee.jisoo@veluga.io');

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reviewApprovalEnabled: true },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: {
        title: 'Regulation',
        contentMarkdown: `---
type: REGULATION
title: Regulation
---
# Body`,
      },
    });
    const id = created.json().doc.id;

    const denied = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toContain('cannot approve REGULATION');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(approved.statusCode).toBe(200);

    await app.close();
  });

  it('applies runtime policy overrides on document approval', async () => {
    const app = buildServer();
    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const approverToken = await login(app, 'lee.jisoo@veluga.io', 'lee.jisoo@veluga.io');

    const policyPatch = await app.inject({
      method: 'PUT',
      url: '/api/admin/policy',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...defaultPolicy, review: { ...defaultPolicy.review, overrides: { REGULATION: ['OWNER'] } } },
    });
    expect(policyPatch.statusCode).toBe(200);

    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reviewApprovalEnabled: true },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: {
        title: 'Runtime Regulation',
        contentMarkdown: `---
type: REGULATION
title: Runtime Regulation
---
# Body`,
      },
    });
    const id = created.json().doc.id;

    const denied = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toContain('cannot approve REGULATION');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/approve`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(approved.statusCode).toBe(200);

    await app.close();
  });
});
