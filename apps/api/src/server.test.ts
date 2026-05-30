import { describe, expect, it } from 'vitest';
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
});
