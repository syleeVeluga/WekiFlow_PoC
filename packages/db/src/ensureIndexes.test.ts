import { describe, expect, it } from 'vitest';
import { ensureIndexes } from './ensureIndexes.js';

describe('ensureIndexes', () => {
  it('creates expected collection indexes idempotently', async () => {
    const calls: string[] = [];
    const db = {
      collection(name: string) {
        return {
          async createIndex() {
            calls.push(name);
          },
        };
      },
    };

    await ensureIndexes(db as never);

    expect(calls).toContain('documents');
    expect(calls).toContain('kg_nodes');
    expect(calls).toContain('knowledge_candidates');
    expect(calls).toContain('sandbox_runs');
  });
});
