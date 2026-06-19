import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '@wekiflow/wkf';
import { CURATION_SCAN_JOB_ID, registerCurationSchedule, runCurationPlaceholder, runCurationScan } from './pipeline.js';

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

async function bundle(): Promise<string> {
  const root = join(tmpdir(), `curation-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'policy.md'),
    `---
type: REGULATION
title: Policy
slug: policy
tags: []
last_verified: 2026-01-01T00:00:00.000Z
---
# Body
`,
    'utf8',
  );
  return root;
}

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

  it('placeholder receives queued concept jobs', async () => {
    await expect(
      runCurationPlaceholder({ type: 'CURATE_CONCEPT', concept: { slug: 'policy', path: 'policy.md', type: 'REGULATION', staleSince: '2026-04-01T00:00:00.000Z' } }),
    ).resolves.toEqual({ slug: 'policy', status: 'queued' });
  });
});
