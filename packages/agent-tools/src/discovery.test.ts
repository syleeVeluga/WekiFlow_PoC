import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import type { Db } from 'mongodb';
import type { SandboxRunner } from '@wf/sandbox';
import { createMainTools } from './index.js';
import {
  DISCOVERY_DECOMPOSE_PROMPT,
  DISCOVERY_SYSTEM_PROMPT,
  decomposeQuestion,
  discoveryAgentAsTool,
  rerankDiscoveryContexts,
} from './discovery.js';

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

function systemPrompt(call: unknown): unknown {
  return (call as { prompt?: Array<{ role: string; content: unknown }> }).prompt?.find((message) => message.role === 'system')?.content;
}

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

  it('uses decomposition prompt overrides and preserves the constant fallback', async () => {
    const response = {
      content: [{ type: 'text', text: JSON.stringify({ baseline: 'leave policy', variants: [] }) }],
      finishReason: 'stop',
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
      warnings: [],
    } as const;
    const model = new MockLanguageModelV3({ doGenerate: response } as never);
    await decomposeQuestion(model, 'leave policy', { prompt: 'DISCOVERY DECOMPOSE OVERRIDE' });
    expect(systemPrompt(model.doGenerateCalls[0])).toBe('DISCOVERY DECOMPOSE OVERRIDE');

    const fallbackModel = new MockLanguageModelV3({ doGenerate: response } as never);
    await decomposeQuestion(fallbackModel, 'leave policy');
    expect(systemPrompt(fallbackModel.doGenerateCalls[0])).toBe(DISCOVERY_DECOMPOSE_PROMPT);
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

  it('uses discovery system prompt overrides and preserves the constant fallback', async () => {
    const response = {
      content: [{ type: 'text', text: 'Answer from context.' }],
      finishReason: 'stop',
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
      warnings: [],
    } as const;
    const model = new MockLanguageModelV3({ doGenerate: response } as never);
    await discoveryAgentAsTool({
      jobId: 'job-1',
      model,
      tools: {},
      prompts: { discoverySystem: 'DISCOVERY SYSTEM OVERRIDE' },
      agentParams: { discoveryStepLimit: 3 },
    }).execute!({ question: 'What is A?' }, { toolCallId: 'd2', messages: [] });
    expect(systemPrompt(model.doGenerateCalls[0])).toBe('DISCOVERY SYSTEM OVERRIDE');

    const fallbackModel = new MockLanguageModelV3({ doGenerate: response } as never);
    await discoveryAgentAsTool({ jobId: 'job-1', model: fallbackModel, tools: {} }).execute!(
      { question: 'What is A?' },
      { toolCallId: 'd3', messages: [] },
    );
    expect(systemPrompt(fallbackModel.doGenerateCalls[0])).toBe(DISCOVERY_SYSTEM_PROMPT);
  });
});
