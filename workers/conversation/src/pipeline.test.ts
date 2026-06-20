import { describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { runConversationIngest } from './pipeline.js';

function makeFakeDb(): Db {
  const rows: Record<string, unknown>[] = [];
  return {
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        rows.push(doc);
        return { insertedId: doc._id };
      },
      findOne: async (filter: Record<string, unknown>) =>
        rows.find((row) => String(row._id) === String(filter._id)) ?? null,
      find: () => ({ sort: () => ({ toArray: async () => rows }) }),
    }),
  } as unknown as Db;
}

describe('runConversationIngest', () => {
  it('creates needs-check candidates from manual transcripts', async () => {
    const result = await runConversationIngest(
      {
        source: 'manual',
        transcript: 'Jin: Decision: security answers need approval.',
        workspaceId: 'workspace-1',
      },
      { db: makeFakeDb() },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      status: 'NEEDS_CHECK',
      workspaceId: 'workspace-1',
      provenance: {
        kind: 'conversation',
        speaker: 'Jin',
        needsSource: true,
      },
    });
  });

  it('uses PR-29 meeting connector refs', async () => {
    const result = await runConversationIngest(
      { source: 'meeting', ref: 'meeting://transcripts/product-sync-2026-06-20' },
      { db: makeFakeDb() },
    );

    expect(result.sourceRef).toBe('meeting://transcripts/product-sync-2026-06-20');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.provenance.kind).toBe('conversation');
  });
});
