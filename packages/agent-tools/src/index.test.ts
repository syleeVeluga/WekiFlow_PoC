import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { MockLanguageModelV3 } from 'ai/test';
import type { SandboxRunner } from '@wf/sandbox';
import { createMainTools, extractTripletsDeterministic, type AgentStep } from './index.js';

/** Minimal in-memory MongoDB stand-in covering the methods the tools touch. */
function makeFakeDb(seed: { documents?: Record<string, unknown>[]; chunks?: Record<string, unknown>[] } = {}): Db {
  const store: Record<string, Record<string, unknown>[]> = {
    documents: seed.documents ?? [],
    chunks: seed.chunks ?? [],
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

  it('flags unverified claims via sandbox grep (allVerified=false when evidence missing)', async () => {
    const tools = createMainTools({
      ...baseCtx,
      db: makeFakeDb(),
      sandbox: sandboxStub(async ({ code }) => {
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
});
