import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { buildServer } from './server.js';

async function login(app: ReturnType<typeof buildServer>, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return res.json().token as string;
}

describe('@wf/api routes', () => {
  it('ingests into review, blocks unauthorized approve, and enqueues graph on approve', async () => {
    const app = buildServer();

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { title: '연차 규정', contentMarkdown: '# 신규 규정' },
    });
    expect(ingest.statusCode).toBe(200);
    const ingestBody = ingest.json();
    expect(ingestBody.doc.status).toBe('REVIEW');
    expect(ingestBody.job.type).toBe('INGEST');

    const reviews = await app.inject({ method: 'GET', url: '/api/reviews' });
    expect(reviews.json()).toHaveLength(1);

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

    const ownerToken = await login(app, 'admin01@veluga.io', 'admin01@veluga.io');
    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${ingestBody.doc.id}/approve`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().doc.status).toBe('PUBLISHED');
    expect(approved.json().job.type).toBe('EXTRACT_TRIPLETS');

    await app.close();
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

    await app.close();
  });
});
