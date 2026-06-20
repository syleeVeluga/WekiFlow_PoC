import { describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import type { SandboxRunner } from '@wf/sandbox';
import { MAIN_AGENT_SYSTEM_PROMPT, type AgentStep } from '@wf/agent-tools';
import { extractCandidateResult, extractMergeResult, runMainPipeline } from './pipeline.js';

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
      insertOne: async (doc: Record<string, unknown>) => {
        rows.push(doc);
        return { insertedId: doc._id };
      },
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
      findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((r) => matches(r, filter));
        if (row && update.$set) Object.assign(row, update.$set);
        return row ?? null;
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

function systemPrompt(call: unknown): unknown {
  return (call as { prompt?: Array<{ role: string; content: unknown }> }).prompt?.find((message) => message.role === 'system')?.content;
}

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

describe('extractCandidateResult', () => {
  it('returns the most recent valid disposition output from steps', () => {
    const disposition = extractCandidateResult([
      { toolResults: [{ toolName: 'tool_decide_disposition', output: { action: 'skip' } }] },
      {
        toolResults: [
          {
            toolName: 'tool_decide_disposition',
            output: {
              action: 'enhance',
              status: 'NEEDS_APPROVAL',
              targetDocId: 'doc-1',
              riskFactors: ['policy'],
              conflictWith: [],
              reason: 'Strong match.',
            },
          },
        ],
      },
    ]);

    expect(disposition).toMatchObject({
      action: 'enhance',
      targetDocId: 'doc-1',
      status: 'NEEDS_APPROVAL',
    });
  });
});

describe('runMainPipeline (agent loop)', () => {
  it('uses main prompt overrides and preserves the constant fallback', async () => {
    const id = new ObjectId();
    const db = makeFakeDb([
      { _id: id, title: 'Prompt', slug: 'prompt', contentMarkdown: '# Prompt', status: 'PROCESSING' },
    ]);
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'no merge' }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);

    await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-main-prompt',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
      prompts: { main: 'MAIN PROMPT OVERRIDE' },
      agentParams: { mainStepLimit: 5 },
      preview: true,
    });

    expect(systemPrompt(model.doGenerateCalls[0])).toBe('MAIN PROMPT OVERRIDE');

    const fallbackModel = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'no merge' }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);
    await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-main-fallback',
      embed: async (texts) => texts.map(() => [1, 0]),
      model: fallbackModel,
      embeddingModel: 'text-embedding-3-large',
      preview: true,
    });

    expect(systemPrompt(fallbackModel.doGenerateCalls[0])).toBe(MAIN_AGENT_SYSTEM_PROMPT);
  });

  it('drives the agent to merge, persists the draft, and transitions to REVIEW', async () => {
    const id = new ObjectId();
    const db = makeFakeDb([
      { _id: id, title: '연차 규정', slug: 'leave', contentMarkdown: '# 연차 규정', status: 'PROCESSING' },
    ]);
    const merged = { mergedMarkdown: '# 연차 규정\n신입사원은 연차 15일을 부여받는다.', changeSummary: '연차 15일 반영' };

    // Scripted: 1) decide disposition  2) request tool_merge  3) merge returns JSON  4) finish.
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'd1',
              toolName: 'tool_decide_disposition',
              input: JSON.stringify({
                sourceText: 'general leave regulation update',
                existingMatches: [],
              }),
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
    expect(steps.map((s) => s.tool)).toContain('tool_decide_disposition');
  });

  it('persists an enrichment candidate from the disposition and merge result', async () => {
    const id = new ObjectId();
    const targetId = new ObjectId();
    const db = makeFakeDb([
      { _id: id, title: 'Policy intake', slug: 'policy-intake', contentMarkdown: '# Policy intake', status: 'PROCESSING' },
      { _id: targetId, title: 'Policy handbook', slug: 'policy-handbook', contentMarkdown: '# Policy handbook', status: 'PUBLISHED' },
    ]);
    const merged = {
      mergedMarkdown: '# Policy intake\nOfficial answer update.',
      changeSummary: 'Added official answer policy.',
    };
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'd1',
              toolName: 'tool_decide_disposition',
              input: JSON.stringify({
                sourceText: 'official answer policy update',
                existingMatches: [{ documentId: targetId.toString(), score: 0.8 }],
              }),
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
              input: JSON.stringify({ facts: [{ source: 'policy', content: 'Official answer update.' }] }),
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

    const result = await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-candidate',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
    });

    expect(result.status).toBe('REVIEW');
    expect(result.disposition).toMatchObject({ action: 'enhance', targetDocId: targetId.toString() });
    expect(result.candidate).toMatchObject({
      title: 'Policy intake',
      bodyMarkdown: merged.mergedMarkdown,
      linkedDocId: targetId.toString(),
      status: 'NEEDS_APPROVAL',
      riskFactors: ['policy', 'official_answer'],
    });
    const persisted = await db.collection('documents').findOne({ _id: id });
    expect(persisted?.draftMarkdown).toBe(merged.mergedMarkdown);
  });

  it('keeps source-only intake out of review drafts while saving a candidate', async () => {
    const id = new ObjectId();
    const db = makeFakeDb([
      { _id: id, title: 'Raw transcript', slug: 'raw-transcript', contentMarkdown: '# Raw transcript', status: 'PROCESSING' },
    ]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'd1',
              toolName: 'tool_decide_disposition',
              input: JSON.stringify({
                sourceText: 'meeting transcript that needs source preservation',
                preserveSourceOnly: true,
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'source only' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const result = await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-source-only',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
    });

    expect(result.status).toBe('SOURCE_ONLY');
    expect(result.merged).toBe(false);
    expect(result.candidate).toMatchObject({
      title: 'Raw transcript',
      bodyMarkdown: '# Raw transcript',
      status: 'NEEDS_CHECK',
    });
    const persisted = await db.collection('documents').findOne({ _id: id });
    expect(persisted?.draftMarkdown).toBeNull();
    expect(persisted?.status).toBe('DRAFT');
  });

  it('keeps preview drafts in PREVIEW status', async () => {
    const id = new ObjectId();
    const db = makeFakeDb([
      {
        _id: id,
        title: 'Preview',
        slug: 'preview',
        contentMarkdown: '# Preview',
        status: 'PREVIEW',
        preview: true,
      },
    ]);
    const merged = { mergedMarkdown: '# Preview\nMerged', changeSummary: 'Preview merge' };
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'm1',
              toolName: 'tool_merge',
              input: JSON.stringify({ facts: [{ source: 'preview', content: 'Merged' }] }),
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

    const result = await runMainPipeline(id.toString(), {
      db,
      sandbox: sandboxStub,
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-preview',
      embed: async (texts) => texts.map(() => [1, 0]),
      model,
      embeddingModel: 'text-embedding-3-large',
      preview: true,
    });

    expect(result.status).toBe('PREVIEW');
    expect(result.draftMarkdown).toBe(merged.mergedMarkdown);
    const persisted = await db.collection('documents').findOne({ _id: id });
    expect(persisted?.draftMarkdown).toBe(merged.mergedMarkdown);
    expect(persisted?.status).toBe('PREVIEW');
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
              toolCallId: 'd1',
              toolName: 'tool_decide_disposition',
              input: JSON.stringify({
                sourceText: 'annual leave for new hires',
                existingMatches: [],
              }),
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
    expect(steps.map((step) => step.tool)).toEqual(['tool_decide_disposition', 'tool_hybrid_retrieve', 'tool_merge']);
    expect(steps[1]).toMatchObject({
      tool: 'tool_hybrid_retrieve',
      result: { graphPathCount: 1, fusedCount: 1, exactGraphStartMatch: true },
    });
  });
});
