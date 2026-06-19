import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { runLearnerJob } from './pipeline.js';

class MemoryCollection {
  rows: Record<string, unknown>[] = [];

  async findOne(filter: Record<string, unknown>) {
    return this.rows.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null;
  }

  find() {
    return {
      toArray: async () => this.rows,
      sort: () => ({ toArray: async () => this.rows }),
    };
  }

  async insertMany(rows: Record<string, unknown>[]) {
    this.rows.push(...rows);
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) {
    let row = this.rows.find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
    if (!row && options?.upsert) {
      row = { ...filter, ...((update.$setOnInsert as Record<string, unknown> | undefined) ?? {}) };
      this.rows.push(row);
      return { upsertedCount: 1 };
    }
    return { upsertedCount: 0 };
  }
}

function makeDb(seed: Record<string, Record<string, unknown>[]>) {
  const collections = new Map<string, MemoryCollection>();
  return {
    collection(name: string) {
      let collection = collections.get(name);
      if (!collection) {
        collection = new MemoryCollection();
        collection.rows = seed[name] ?? [];
        collections.set(name, collection);
      }
      return collection;
    },
  } as never;
}

describe('runLearnerJob', () => {
  it('stores proposals and eval goldens from a judged trajectory', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              proposals: [
                {
                  gapType: 'MISSING_RELATION',
                  targetSlug: 'hr/leave',
                  instruction: 'Add relation.',
                  evidence: { reasoning: 'graph empty', stepQuote: 'tool_hybrid_retrieve graphPathCount=0' },
                  priority: 1,
                  evalCandidate: { valid: true, intent: 'new hire leave', goldenAnswer: '15 days' },
                },
              ],
            }),
          },
        ],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);
    const db = makeDb({
      jobs: [{ bullJobId: 'main-1', agentSteps: [{ tool: 'tool_hybrid_retrieve', args: {}, result: { graphPathCount: 0 } }] }],
    });

    const result = await runLearnerJob({ type: 'LEARN_TRAJECTORY', jobId: 'main-1' }, { db, model });

    expect(result.proposalCount).toBe(1);
    expect(result.goldenCount).toBe(1);
    expect(result.proposals[0]).toMatchObject({ gapType: 'MISSING_RELATION', status: 'OPEN' });
  });
});
