import { describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import type { SandboxRunner } from '@wf/sandbox';
import type { AgentStep } from '@wf/agent-tools';
import { extractMergeResult, runMainPipeline } from './pipeline.js';

function makeFakeDb(
  documents: Record<string, unknown>[],
  extra: Record<string, Record<string, unknown>[]> = {},
): Db {
  const store: Record<string, Record<string, unknown>[]> = { documents, chunks: [], ...extra };
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
  const collection = (name: string) => {
    const rows = (store[name] ??= []);
    return {
      find: (filter: Record<string, unknown> = {}) => ({
        toArray: async () => rows.filter((row) => matches(row, filter)),
      }),
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      insertMany: async (docs: Record<string, unknown>[]) => void rows.push(...docs),
      deleteMany: async (filter: Record<string, unknown>) => {
        const keep = rows.filter((row) => !matches(row, filter));
        rows.length = 0;
        rows.push(...keep);
      },
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((r) => matches(r, filter));
        if (row && update.$set) Object.assign(row, update.$set);
      },
    };
  };
  return { collection } as unknown as Db;
}

const sandboxStub: SandboxRunner = {
  async run() {
    return { stdout: '', stderr: '', exitCode: 0, truncated: false };
  },
};

describe('extractMergeResult', () => {
  it('returns the most recent valid tool_merge output from steps', () => {
    const merged = extractMergeResult([
      { toolResults: [{ toolName: 'tool_search_vector', output: { results: [] } }] },
      { toolResults: [{ toolName: 'tool_merge', output: { mergedMarkdown: '# X', changeSummary: 'y' } }] },
    ]);
    expect(merged).toEqual({ mergedMarkdown: '# X', changeSummary: 'y' });
  });

  it('returns undefined when no merge step is present', () => {
    expect(extractMergeResult([{ toolResults: [] }])).toBeUndefined();
  });
});

describe('runMainPipeline (agent loop)', () => {
  it('drives the agent to merge, persists the draft, and transitions to REVIEW', async () => {
    const id = new ObjectId();
    const db = makeFakeDb([
      { _id: id, title: '연차 규정', slug: 'leave', contentMarkdown: '# 연차 규정', status: 'PROCESSING' },
    ]);
    const merged = { mergedMarkdown: '# 연차 규정\n신입사원은 연차 15일을 부여받는다.', changeSummary: '연차 15일 반영' };

    // Scripted: 1) agent requests tool_merge  2) merge's generateObject returns JSON  3) agent finishes.
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'm1',
              toolName: 'tool_merge',
              input: JSON.stringify({
                documentId: id.toString(),
                facts: [{ source: 'sandbox', content: '연차 15일' }],
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: JSON.stringify(merged) }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: '병합과 검증을 완료했습니다.' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const steps: AgentStep[] = [];
    const result = await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-1',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
      recordStep: (step) => void steps.push(step),
    });

    expect(result.status).toBe('REVIEW');
    expect(result.merged).toBe(true);
    expect(result.draftMarkdown).toBe(merged.mergedMarkdown);
    expect(result.changeSummary).toBe(merged.changeSummary);

    const persisted = await db.collection('documents').findOne({ _id: id });
    expect(persisted?.draftMarkdown).toBe(merged.mergedMarkdown);
    expect(persisted?.status).toBe('REVIEW');
    expect(steps.map((s) => s.tool)).toContain('tool_merge');
  });

  it('lets Pipeline A retrieve graph-indexed facts and pass them into merge', async () => {
    const id = new ObjectId();
    const newHire = new ObjectId();
    const annualLeave = new ObjectId();
    const db = makeFakeDb(
      [{ _id: id, title: 'Onboarding', slug: 'onboarding', contentMarkdown: '# Onboarding\nNew hire note', status: 'PROCESSING' }],
      {
        kg_nodes: [
          { _id: newHire, name: 'New Hire', normalizedName: 'newhire', type: 'PERSON' },
          { _id: annualLeave, name: 'Annual Leave 15 Days', normalizedName: 'annualleave15days', type: 'REGULATION' },
        ],
        kg_edges: [{ subjectId: newHire, predicate: 'receives', objectId: annualLeave, strength: 0.9 }],
      },
    );
    const merged = {
      mergedMarkdown: '# Onboarding\nNew hires receive Annual Leave 15 Days.',
      changeSummary: 'Added graph-backed annual leave relation.',
    };

    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'h1',
              toolName: 'tool_hybrid_retrieve',
              input: JSON.stringify({ query: 'annual leave for new hires', startEntity: 'New Hire', k: 4 }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'm1',
              toolName: 'tool_merge',
              input: JSON.stringify({
                facts: [{ source: 'graph', content: 'New Hire -[receives, strength=0.9]-> Annual Leave 15 Days' }],
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: JSON.stringify(merged) }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'done' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const steps: AgentStep[] = [];
    const result = await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-graph',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
      recordStep: (step) => void steps.push(step),
    });

    expect(result.merged).toBe(true);
    expect(result.draftMarkdown).toBe(merged.mergedMarkdown);
    expect(steps.map((step) => step.tool)).toEqual(['tool_hybrid_retrieve', 'tool_merge']);
    expect(steps[0]).toMatchObject({
      tool: 'tool_hybrid_retrieve',
      result: { graphPathCount: 1, fusedCount: 2, exactGraphStartMatch: true },
    });
  });
});
