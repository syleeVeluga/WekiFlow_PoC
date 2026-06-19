import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultPolicy } from './policy.js';
import { scanStale } from './scan.js';

async function writeDoc(root: string, slug: string, type: string, timestamp?: string): Promise<void> {
  const parts = slug.split('/');
  const file = `${parts.pop()}.md`;
  const dir = join(root, ...parts);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, file),
    `---
type: ${type}
title: ${slug}
slug: ${slug}
tags: []
${timestamp ? `last_verified: ${timestamp}\n` : ''}
---
# Body
`,
    'utf8',
  );
}

describe('scanStale', () => {
  it('classifies stale concepts by type-specific freshness', async () => {
    const root = join(tmpdir(), `wkf-scan-${randomUUID()}`);
    await writeDoc(root, 'hr/old-regulation', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, 'hr/fresh-policy', 'POLICY', '2026-05-01T00:00:00.000Z');
    await writeDoc(root, 'metrics/unverified', 'METRIC');

    const stale = await scanStale(root, defaultPolicy, { now: new Date('2026-06-19T00:00:00.000Z') });
    expect(stale.map((entry) => entry.slug)).toEqual(['hr/old-regulation', 'metrics/unverified']);
  });

  it('applies scan limits', async () => {
    const root = join(tmpdir(), `wkf-scan-${randomUUID()}`);
    await writeDoc(root, 'a', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, 'b', 'REGULATION', '2026-01-01T00:00:00.000Z');

    expect(await scanStale(root, defaultPolicy, { now: new Date('2026-06-19T00:00:00.000Z'), limit: 1 })).toHaveLength(1);
  });

  it('skips reserved generated and reference files', async () => {
    const root = join(tmpdir(), `wkf-scan-${randomUUID()}`);
    await writeDoc(root, 'concept', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, 'references/source', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, '.wkf/internal', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, '.ref/reference-copy', 'REGULATION', '2026-01-01T00:00:00.000Z');
    await writeDoc(root, 'area/log', 'REGULATION', '2026-01-01T00:00:00.000Z');

    const stale = await scanStale(root, defaultPolicy, { now: new Date('2026-06-19T00:00:00.000Z') });
    expect(stale.map((entry) => entry.path)).toEqual(['concept.md']);
  });
});
