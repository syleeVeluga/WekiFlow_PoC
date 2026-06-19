import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import type { Db } from 'mongodb';
import type { SandboxRunner } from '@wf/sandbox';
import { createMainTools } from './index.js';
import { decomposeQuestion, discoveryAgentAsTool, rerankDiscoveryContexts } from './discovery.js';

function makeFakeDb(seed: Record<string, Record<string, unknown>[]> = {}): Db {
  const store: Record<string, Record<string, unknown>[]> = { documents: [], chunks: [], ...seed };
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
  return {
    collection(name: string) {
      const rows = (store[name] ??= []);
      return {
        find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => rows.filter((row) => matches(row, filter)) }),
        findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      };
    },
  } as unknown as Db;
}

const sandbox: SandboxRunner = { run: async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false }) };

describe('discovery', () => {
  it('decomposes into baseline plus unique variants', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ baseline: 'leave policy', variants: ['annual leave', 'leave policy'] }) }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);

    await expect(decomposeQuestion(model, 'leave policy')).resolves.toEqual(['leave policy', 'annual leave']);
  });

  it('deduplicates and reranks contexts across decomposed queries', () => {
    const contexts = rerankDiscoveryContexts(
      [
        { query: 'q1', contexts: [{ source: 'vector', content: 'A', documentId: 'd1', score: 0.1, ranks: { vector: 1 } }] },
        { query: 'q2', contexts: [{ source: 'vector', content: 'A again', documentId: 'd1', score: 0.1, ranks: { vector: 1 } }] },
      ],
      5,
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.documentId).toBe('d1');
  });

  it('wraps hybrid retrieval with decomposition and slug-level dedup', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ baseline: 'annual leave', variants: ['new hire leave'] }) }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);
    const tools = createMainTools({
      db: makeFakeDb({
        chunks: [{ documentId: 'd1', text: 'New hires receive annual leave.', headingPath: ['Policy'], embedding: [1, 0] }],
      }),
      sandbox,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-1',
      documentId: 'doc-1',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      decomposeHybridRetrieve: true,
    });

    const result = (await tools.tool_hybrid_retrieve.execute!(
      { query: 'annual leave?', k: 5, maxDepth: 2 },
      { toolCallId: 'h1', messages: [] },
    )) as { contexts: Array<{ documentId?: string }>; exactGraphStartMatch: boolean };

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]!.documentId).toBe('d1');
  });

  it('exposes discovery as a callable agent tool', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [{ type: 'text', text: 'Answer from context.' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);
    const steps: unknown[] = [];
    const wrapped = discoveryAgentAsTool({
      jobId: 'job-1',
      model,
      tools: {},
      recordStep: (step) => void steps.push(step),
    });

    const result = await wrapped.execute!({ question: 'What is A?' }, { toolCallId: 'd1', messages: [] });
    expect(result).toEqual({ answer: 'Answer from context.' });
    expect(steps).toHaveLength(1);
  });
});
