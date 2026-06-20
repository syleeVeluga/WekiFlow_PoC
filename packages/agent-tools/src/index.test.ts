import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { MockLanguageModelV3 } from 'ai/test';
import type { SandboxRunner } from '@wf/sandbox';
import { DEFAULT_AGENT_PARAMS } from '@wf/shared';
import { createMainTools, extractTripletsDeterministic, fuseHybridRetrieval, MERGE_SYSTEM_PROMPT, type AgentStep } from './index.js';

/** Minimal in-memory MongoDB stand-in covering the methods the tools touch. */
function makeFakeDb(seed: Record<string, Record<string, unknown>[]> = {}): Db {
  const store: Record<string, Record<string, unknown>[]> = {
    documents: seed.documents ?? [],
    chunks: seed.chunks ?? [],
    ...seed,
  };
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));

  const collection = (name: string) => {
    const rows = (store[name] ??= []);
    return {
      find: (filter: Record<string, unknown> = {}) => ({
        toArray: async () => rows.filter((row) => matches(row, filter)),
      }),
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      insertMany: async (docs: Record<string, unknown>[]) => {
        rows.push(...docs);
      },
      deleteMany: async (filter: Record<string, unknown>) => {
        store[name] = rows.filter((row) => !matches(row, filter));
      },
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((r) => matches(r, filter));
        if (row && update.$set) Object.assign(row, update.$set);
      },
    };
  };
  return { collection } as unknown as Db;
}

const sandboxStub = (run: SandboxRunner['run']): SandboxRunner => ({ run });

const baseCtx = {
  docsSnapshotDir: '/tmp/docs',
  jobId: 'job-1',
  documentId: 'doc-1',
  embed: async (texts: string[]) => texts.map(() => [1, 0]),
  model: new MockLanguageModelV3(),
};

function parseInput(tool: { inputSchema: unknown }, input: unknown) {
  return (tool.inputSchema as { parse: (input: unknown) => unknown }).parse(input) as Record<string, unknown>;
}

function systemPrompt(call: unknown): unknown {
  return (call as { prompt?: Array<{ role: string; content: unknown }> }).prompt?.find((message) => message.role === 'system')?.content;
}

describe('@wf/agent-tools', () => {
  it('extracts stable schema-valid PoC triplets', () => {
    const result = extractTripletsDeterministic(`
      연차 규정 제4조 2항: 신입사원은 입사와 동시에 연차 15일을 부여받는다.
      연차 사용 신청은 부서장의 결재를 받아야 한다.
    `);

    expect(result.triplets.map((triplet) => triplet.object)).toContain('연차 15일');
    expect(result.triplets.map((triplet) => triplet.object)).toContain('부서장');
  });

  it('records sandbox terminal calls for jobs.agentSteps auditing', async () => {
    const steps: AgentStep[] = [];
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb(),
      sandbox: sandboxStub(async () => ({ stdout: 'ok', stderr: '', exitCode: 0, truncated: false })),
      recordStep: (step) => void steps.push(step),
    });

    const result = await tools.tool_execute_sandbox_terminal.execute!(
      { code: 'rg annual /docs', language: 'bash', timeoutMs: 10_000 },
      { toolCallId: 't1', messages: [] },
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.tool).toBe('tool_execute_sandbox_terminal');
  });

  it('ranks vector hits by cosine similarity to the query embedding', async () => {
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb({
        chunks: [
          { documentId: 'd1', text: '연차 15일', headingPath: ['휴가'], embedding: [1, 0] },
          { documentId: 'd1', text: '무관한 내용', headingPath: ['기타'], embedding: [0, 1] },
        ],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });

    const { results } = (await tools.tool_search_vector.execute!(
      { query: '연차', k: 8 },
      { toolCallId: 't2', messages: [] },
    )) as { results: Array<{ text: string; score: number }> };

    expect(results[0]!.text).toBe('연차 15일');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('searches the knowledge graph with multi-hop BFS and blocks cycles', async () => {
    const start = new ObjectId();
    const leave = new ObjectId();
    const approval = new ObjectId();
    const steps: AgentStep[] = [];
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb({
        kg_nodes: [
          { _id: start, name: 'New Hire', normalizedName: 'newhire', type: 'PERSON' },
          { _id: leave, name: 'Annual Leave 15 Days', normalizedName: 'annualleave15days', type: 'REGULATION' },
          { _id: approval, name: 'Department Head Approval', normalizedName: 'departmentheadapproval', type: 'POLICY' },
        ],
        kg_edges: [
          { subjectId: start, predicate: 'receives', objectId: leave, strength: 0.9, sourceDocIds: [new ObjectId()] },
          { subjectId: leave, predicate: 'requires', objectId: approval, strength: 0.8, sourceDocIds: [] },
          { subjectId: approval, predicate: 'mentions', objectId: start, strength: 0.7, sourceDocIds: [] },
        ],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
      recordStep: (step) => void steps.push(step),
    });

    const result = (await tools.tool_search_graph.execute!(
      { startEntity: 'New Hire', maxDepth: 3 },
      { toolCallId: 'g1', messages: [] },
    )) as { paths: Array<{ nodes: string[]; edges: Array<{ predicate: string }> }>; exactMatch: boolean };

    expect(result.exactMatch).toBe(true);
    expect(result.paths.map((path) => path.edges.map((edge) => edge.predicate).join('>'))).toContain(
      'receives>requires',
    );
    expect(result.paths.every((path) => new Set(path.nodes).size === path.nodes.length)).toBe(true);
    expect(steps[0]).toMatchObject({ tool: 'tool_search_graph', result: { pathCount: 2, exactMatch: true } });
    expect(typeof steps[0]!.tookMs).toBe('number');
  });

  it('falls back to the closest graph node when the start entity is not an exact normalized match', async () => {
    const start = new ObjectId();
    const leave = new ObjectId();
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb({
        kg_nodes: [
          { _id: start, name: 'New Hire', normalizedName: 'newhire', type: 'PERSON' },
          { _id: leave, name: 'Annual Leave 15 Days', normalizedName: 'annualleave15days', type: 'REGULATION' },
        ],
        kg_edges: [{ subjectId: start, predicate: 'receives', objectId: leave, strength: 0.9 }],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });

    const result = (await tools.tool_search_graph.execute!(
      { startEntity: 'new hires', maxDepth: 1 },
      { toolCallId: 'g2', messages: [] },
    )) as { paths: Array<{ nodes: string[] }>; startNodes: Array<{ name: string }>; exactMatch: boolean };

    expect(result.exactMatch).toBe(false);
    expect(result.startNodes[0]!.name).toBe('New Hire');
    expect(result.paths[0]!.nodes).toEqual(['New Hire', 'Annual Leave 15 Days']);
  });

  it('fuses vector hits and graph paths for hybrid retrieval context', async () => {
    const start = new ObjectId();
    const leave = new ObjectId();
    const steps: AgentStep[] = [];
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb({
        chunks: [{ documentId: 'd1', text: 'New hires receive annual leave.', headingPath: ['Policy'], embedding: [1, 0] }],
        kg_nodes: [
          { _id: start, name: 'New Hire', normalizedName: 'newhire', type: 'PERSON' },
          { _id: leave, name: 'Annual Leave 15 Days', normalizedName: 'annualleave15days', type: 'REGULATION' },
        ],
        kg_edges: [{ subjectId: start, predicate: 'receives', objectId: leave, strength: 0.9 }],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
      recordStep: (step) => void steps.push(step),
    });

    const result = (await tools.tool_hybrid_retrieve.execute!(
      { query: 'annual leave for new hires', startEntity: 'New Hire', k: 4, maxDepth: 2 },
      { toolCallId: 'h1', messages: [] },
    )) as { contexts: Array<{ source: string; content: string; score: number }> };

    expect(result.contexts.map((context) => context.source)).toEqual(expect.arrayContaining(['vector', 'graph']));
    expect(result.contexts.find((context) => context.source === 'graph')!.content).toContain('New Hire -[receives');
    expect(steps[0]).toMatchObject({
      tool: 'tool_hybrid_retrieve',
      result: { vectorCount: 1, graphPathCount: 1, fusedCount: 2 },
    });
  });

  it('uses reciprocal rank fusion ordering for mixed retrieval hits', () => {
    const contexts = fuseHybridRetrieval({
      vectorHits: [{ text: 'vector top', documentId: 'd1', headingPath: [], score: 0.92 }],
      graphPaths: [
        {
          nodes: ['A', 'B'],
          edges: [{ subject: 'A', predicate: 'relates_to', object: 'B', strength: 0.8, sourceDocIds: [] }],
          score: 0.8,
        },
      ],
    });

    expect(contexts).toHaveLength(2);
    expect(contexts[0]!.score).toBeCloseTo(1 / 61);
  });

  it('flags unverified claims via sandbox grep (allVerified=false when evidence missing)', async () => {
    const runs: Array<{ timeoutMs?: number }> = [];
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb(),
      sandbox: sandboxStub(async ({ code, timeoutMs }) => {
        runs.push({ timeoutMs });
        const found = code.includes('연차 15일');
        return {
          stdout: found ? 'leave.md:2:연차 15일' : '',
          stderr: '',
          exitCode: found ? 0 : 1,
          truncated: false,
        };
      }),
    });

    const { results, allVerified } = (await tools.tool_verify_integrity.execute!(
      { documentId: 'd1', draftMarkdown: '...', claims: ['연차 15일', '연차 30일'] },
      { toolCallId: 't3', messages: [] },
    )) as { results: Array<{ claim: string; verified: boolean }>; allVerified: boolean };

    expect(allVerified).toBe(false);
    expect(results.find((r) => r.claim === '연차 15일')!.verified).toBe(true);
    expect(results.find((r) => r.claim === '연차 30일')!.verified).toBe(false);
    expect(runs.map((run) => run.timeoutMs)).toEqual([8_000, 8_000]);
  });

  it('produces a merged draft via the injected model', async () => {
    const id = new ObjectId();
    const merged = { mergedMarkdown: '# 병합본\n연차 15일', changeSummary: '연차 일수 추가' };
    const tools = createMainTools({
      ...baseCtx,
      documentId: id.toString(),
      model: new MockLanguageModelV3({
        doGenerate: {
          content: [{ type: 'text', text: JSON.stringify(merged) }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      } as never),
      db: makeFakeDb({
        documents: [{ _id: id, title: '연차', slug: 'leave', contentMarkdown: '# 연차', status: 'PROCESSING' }],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });

    const result = await tools.tool_merge.execute!(
      { facts: [{ source: 'sandbox', content: '연차 15일' }] },
      { toolCallId: 't4', messages: [] },
    );

    expect(result).toEqual(merged);
  });

  it('uses the merge prompt override when provided and the constant fallback otherwise', async () => {
    const id = new ObjectId();
    const merged = { mergedMarkdown: '# Merged', changeSummary: 'merged' };
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify(merged) }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);
    const tools = createMainTools({
      ...baseCtx,
      documentId: id.toString(),
      model,
      prompts: { merge: 'MERGE OVERRIDE PROMPT' },
      db: makeFakeDb({
        documents: [{ _id: id, title: 'Doc', slug: 'doc', contentMarkdown: '# Doc', status: 'PROCESSING' }],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });

    await tools.tool_merge.execute!(
      { facts: [{ source: 'test', content: 'fact' }] },
      { toolCallId: 'merge-override', messages: [] },
    );

    expect(systemPrompt(model.doGenerateCalls[0])).toBe('MERGE OVERRIDE PROMPT');

    const fallbackModel = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify(merged) }],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);
    const fallbackTools = createMainTools({
      ...baseCtx,
      documentId: id.toString(),
      model: fallbackModel,
      db: makeFakeDb({
        documents: [{ _id: id, title: 'Doc', slug: 'doc', contentMarkdown: '# Doc', status: 'PROCESSING' }],
      }),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });

    await fallbackTools.tool_merge.execute!(
      { facts: [{ source: 'test', content: 'fact' }] },
      { toolCallId: 'merge-fallback', messages: [] },
    );

    expect(systemPrompt(fallbackModel.doGenerateCalls[0])).toBe(MERGE_SYSTEM_PROMPT);
  });

  it('uses runtime agentParams as tool schema defaults without changing built-in fallbacks', () => {
    const fallbackTools = createMainTools({
      ...baseCtx,
      db: makeFakeDb(),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });
    expect(parseInput(fallbackTools.tool_search_vector, { query: 'q' }).k).toBe(DEFAULT_AGENT_PARAMS.vectorK);
    expect(parseInput(fallbackTools.tool_hybrid_retrieve, { query: 'q' })).toMatchObject({
      k: DEFAULT_AGENT_PARAMS.hybridK,
      maxDepth: DEFAULT_AGENT_PARAMS.graphMaxDepth,
    });
    expect(parseInput(fallbackTools.tool_search_graph, { startEntity: 'A' }).maxDepth).toBe(DEFAULT_AGENT_PARAMS.graphMaxDepth);
    expect(parseInput(fallbackTools.tool_execute_sandbox_terminal, { code: 'true' }).timeoutMs).toBe(
      DEFAULT_AGENT_PARAMS.sandboxTimeoutMs,
    );

    const overrideTools = createMainTools({
      ...baseCtx,
      agentParams: { vectorK: 13, hybridK: 7, graphMaxDepth: 3, sandboxTimeoutMs: 12_345 },
      db: makeFakeDb(),
      sandbox: sandboxStub(async () => ({ stdout: '', stderr: '', exitCode: 0, truncated: false })),
    });
    expect(parseInput(overrideTools.tool_search_vector, { query: 'q' }).k).toBe(13);
    expect(parseInput(overrideTools.tool_hybrid_retrieve, { query: 'q' })).toMatchObject({ k: 7, maxDepth: 3 });
    expect(parseInput(overrideTools.tool_search_graph, { startEntity: 'A' }).maxDepth).toBe(3);
    expect(parseInput(overrideTools.tool_execute_sandbox_terminal, { code: 'true' }).timeoutMs).toBe(12_345);
  });
});
