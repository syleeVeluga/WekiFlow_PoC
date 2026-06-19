import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import { defaultPolicy } from '@wekiflow/wkf';
import type { SandboxRunner } from '@wf/sandbox';
import {
  CURATION_SCAN_JOB_ID,
  extractCurationResult,
  registerCurationSchedule,
  runCurationAgent,
  runCurationScan,
  type CurationConceptJob,
} from './pipeline.js';

function fakeQueue() {
  const jobs: Array<{ name: string; data: unknown; options?: unknown }> = [];
  return {
    jobs,
    async add(name: string, data: unknown, options?: unknown) {
      jobs.push({ name, data, options });
      return { id: String(jobs.length) };
    },
  };
}

function makeFakeDb(documents: Record<string, unknown>[]): Db {
  const rows = documents;
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$ne' in value) return doc[key] !== (value as { $ne: unknown }).$ne;
      return String(doc[key]) === String(value);
    });
  return {
    collection: () => ({
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      findOneAndUpdate: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((candidate) => matches(candidate, filter));
        if (row && update.$set) Object.assign(row, update.$set);
        return row ?? null;
      },
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((candidate) => matches(candidate, filter));
        if (row && update.$set) Object.assign(row, update.$set);
      },
      insertOne: async (doc: Record<string, unknown>) => {
        rows.push(doc);
        return { insertedId: doc._id };
      },
    }),
  } as unknown as Db;
}

const sandboxStub: SandboxRunner = {
  async run() {
    return { stdout: 'policy.md:7:verified fact', stderr: '', exitCode: 0, truncated: false };
  },
};

async function bundle(): Promise<string> {
  const root = join(tmpdir(), `curation-${randomUUID()}`);
  await mkdir(join(root, '.ref'), { recursive: true });
  const markdown = `---
type: REGULATION
title: Policy
slug: policy
tags: []
last_verified: 2026-01-01T00:00:00.000Z
---
# Body
Original fact
`;
  await writeFile(join(root, 'policy.md'), markdown, 'utf8');
  await writeFile(join(root, '.ref', 'policy.md'), `<!-- WKF reference: read-only -->\n${markdown}`, 'utf8');
  return root;
}

const concept: CurationConceptJob = {
  type: 'CURATE_CONCEPT',
  concept: {
    slug: 'policy',
    path: 'policy.md',
    type: 'REGULATION',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    staleSince: '2026-04-01T00:00:00.000Z',
  },
};

describe('curation pipeline scaffold', () => {
  it('registers a fixed repeatable scan job', async () => {
    const queue = fakeQueue();
    await registerCurationSchedule(queue as never);
    expect(queue.jobs[0]).toMatchObject({ name: 'SCAN_STALE', options: { jobId: CURATION_SCAN_JOB_ID, repeat: { pattern: '0 3 * * *' } } });
  });

  it('queues stale concepts from scanStale', async () => {
    const queue = fakeQueue();
    const root = await bundle();
    const result = await runCurationScan(queue as never, root, {
      policy: defaultPolicy,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });
    expect(result.queued).toBe(1);
    expect(queue.jobs[0]).toMatchObject({
      name: 'CURATE_CONCEPT',
      options: { jobId: 'curate:policy', removeOnComplete: true, removeOnFail: 100 },
    });
  });
});

describe('runCurationAgent', () => {
  it('updates last_verified without moving a draft to review when source facts are unchanged', async () => {
    const root = await bundle();
    const db = makeFakeDb([{ _id: new ObjectId(), slug: 'policy', title: 'Policy', contentMarkdown: '# Body\nOriginal fact', status: 'PUBLISHED' }]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            { type: 'tool-call', toolCallId: 'r1', toolName: 'tool_read_concept', input: JSON.stringify({}) },
            { type: 'tool-call', toolCallId: 'g1', toolName: 'tool_grep_verify', input: JSON.stringify({ query: 'Original fact' }) },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [
            { type: 'tool-call', toolCallId: 'w1', toolName: 'tool_write_concept', input: JSON.stringify({ decision: 'verify' }) },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'verified' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const result = await runCurationAgent(concept, {
      db,
      sandbox: sandboxStub,
      bundlePath: root,
      docsSnapshotDir: root,
      jobId: 'curate-1',
      model,
      policy: defaultPolicy,
      now: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ decision: 'verify', status: 'verified', lastVerified: '2026-06-19T00:00:00.000Z' });
    await expect(readFile(join(root, 'policy.md'), 'utf8')).resolves.toContain('last_verified: 2026-06-19T00:00:00.000Z');
    await expect(readFile(join(root, 'log.md'), 'utf8')).resolves.toContain('**Verify** policy.md: 변경 없음, 재검증 완료. [C]');
    const persisted = await db.collection('documents').findOne({ slug: 'policy' });
    expect(persisted?.draftMarkdown).toBeUndefined();
  });

  it('moves additive enhancement drafts to REVIEW', async () => {
    const root = await bundle();
    const id = new ObjectId();
    const db = makeFakeDb([{ _id: id, slug: 'policy', title: 'Policy', contentMarkdown: '# Body\nOriginal fact', status: 'PUBLISHED' }]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'w1',
              toolName: 'tool_write_concept',
              input: JSON.stringify({ decision: 'enhance', mergedMarkdown: '# Body\nOriginal fact\nNew verified fact', changeSummary: 'Added verified fact.' }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'review' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const result = await runCurationAgent(concept, {
      db,
      sandbox: sandboxStub,
      bundlePath: root,
      docsSnapshotDir: root,
      jobId: 'curate-2',
      model,
      policy: defaultPolicy,
    });

    expect(result).toMatchObject({ decision: 'enhance', status: 'review', documentId: id.toString() });
    const persisted = await db.collection('documents').findOne({ slug: 'policy' });
    expect(persisted?.draftMarkdown).toBe('# Body\nOriginal fact\nNew verified fact');
    expect(persisted?.status).toBe('REVIEW');
    await expect(readFile(join(root, 'log.md'), 'utf8')).resolves.toContain('**Update** policy.md: Added verified fact. [C]');
  });

  it('rejects curation drafts that delete existing headings and records the reason', async () => {
    const root = await bundle();
    const db = makeFakeDb([{ _id: new ObjectId(), slug: 'policy', title: 'Policy', contentMarkdown: '# Body\nOriginal fact', status: 'PUBLISHED' }]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'w1',
              toolName: 'tool_write_concept',
              input: JSON.stringify({ decision: 'enhance', mergedMarkdown: 'Original fact without heading', changeSummary: 'Bad shrink.' }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'rejected' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);
    const steps: Array<{ tool: string; result?: unknown }> = [];

    await expect(
      runCurationAgent(concept, {
        db,
        sandbox: sandboxStub,
        bundlePath: root,
        docsSnapshotDir: root,
        jobId: 'curate-reject',
        model,
        policy: defaultPolicy,
        recordStep: (step) => void steps.push(step),
      }),
    ).rejects.toThrow('Missing preserved heading');
    expect(steps.at(-1)).toMatchObject({ tool: 'tool_write_concept', result: { status: 'rejected' } });
    const persisted = await db.collection('documents').findOne({ slug: 'policy' });
    expect(persisted?.draftMarkdown).toBeUndefined();
  });

  it('skips doubtful cases without writes', async () => {
    const root = await bundle();
    const db = makeFakeDb([{ _id: new ObjectId(), slug: 'policy', title: 'Policy', contentMarkdown: '# Body\nOriginal fact', status: 'PUBLISHED' }]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            { type: 'tool-call', toolCallId: 'w1', toolName: 'tool_write_concept', input: JSON.stringify({ decision: 'skip' }) },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'skip' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const result = await runCurationAgent(concept, {
      db,
      sandbox: sandboxStub,
      bundlePath: root,
      docsSnapshotDir: root,
      jobId: 'curate-3',
      model,
      policy: defaultPolicy,
    });

    expect(result).toEqual({ slug: 'policy', decision: 'skip', status: 'skipped' });
    const persisted = await db.collection('documents').findOne({ slug: 'policy' });
    expect(persisted?.draftMarkdown).toBeUndefined();
  });

  it('creates new reference drafts in REVIEW when the agent chooses create', async () => {
    const root = await bundle();
    const db = makeFakeDb([{ _id: new ObjectId(), slug: 'policy', title: 'Policy', contentMarkdown: '# Body\nOriginal fact', status: 'PUBLISHED' }]);
    const model = new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'w1',
              toolName: 'tool_write_concept',
              input: JSON.stringify({
                decision: 'create',
                createdSlug: 'references/new-source',
                createdTitle: 'New Source',
                mergedMarkdown: '# New Source\nReusable verified context',
                changeSummary: 'Created reference draft.',
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'created' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never);

    const result = await runCurationAgent(concept, {
      db,
      sandbox: sandboxStub,
      bundlePath: root,
      docsSnapshotDir: root,
      jobId: 'curate-4',
      model,
      policy: defaultPolicy,
    });

    expect(result).toMatchObject({ decision: 'create', status: 'review' });
    const persisted = await db.collection('documents').findOne({ slug: 'references/new-source' });
    expect(persisted?.draftMarkdown).toBe('# New Source\nReusable verified context');
    expect(persisted?.status).toBe('REVIEW');
  });

  it('extracts read-only reference context from tool results', () => {
    expect(
      extractCurationResult('policy', [
        { toolResults: [{ toolName: 'tool_read_concept', output: { referenceReadOnly: true } }] },
        { toolResults: [{ toolName: 'tool_write_concept', output: { decision: 'skip', status: 'skipped' } }] },
      ]),
    ).toEqual({ slug: 'policy', decision: 'skip', status: 'skipped' });
  });
});
