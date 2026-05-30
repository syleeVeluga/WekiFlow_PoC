import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { buildServer } from './server.js';

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
      headers: { 'x-user-role': 'VIEWER' },
    });
    expect(denied.statusCode).toBe(403);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/documents/${ingestBody.doc.id}/approve`,
      headers: { 'x-user-role': 'REVIEWER' },
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
      headers: { 'x-user-role': 'VIEWER' },
    });
    expect(denied.statusCode).toBe(403);

    const multi = await app.inject({ method: 'GET', url: '/api/multi-source' });
    expect(multi.statusCode).toBe(200);
    expect(multi.json().length).toBeGreaterThan(0);

    const conflict = multi.json().find((item: { multiSourceType: string }) => item.multiSourceType === 'C');
    const conflictResult = await app.inject({
      method: 'POST',
      url: `/api/multi-source/${conflict.id}/resolve`,
      headers: { 'x-user-role': 'REVIEWER' },
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
});
