import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractLinkGraph, knowledgeItemsToLinkGraph, writeKnowledgeMapHtml } from './index.js';

async function writeConcept(root: string, path: string, markdown: string) {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, markdown, 'utf8');
}

describe('link graph', () => {
  it('extracts markdown links, backlinks, tags, and unresolved links from a bundle', async () => {
    const root = join(tmpdir(), `wkf-map-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    await writeConcept(
      root,
      'policy.md',
      `---
type: POLICY
title: Policy
slug: policy
tags: [hr]
---
# Summary
See [Handbook](handbook.md) and [Missing](missing.md).
![Diagram](handbook.md)
`,
    );
    await writeConcept(
      root,
      'handbook.md',
      `---
type: ENTITY
title: Handbook
slug: handbook
tags: [hr, onboarding]
---
# Summary
Back to [Policy](policy.md).
`,
    );

    const graph = await extractLinkGraph(root);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy', title: 'Policy', backlinkCount: 1, linkCount: 2 }),
      expect.objectContaining({ id: 'handbook', title: 'Handbook', backlinkCount: 1, linkCount: 3 }),
      expect.objectContaining({ id: 'tag:hr', type: 'TAG', backlinkCount: 2 }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'policy', target: 'handbook', kind: 'markdown_link' }),
      expect.objectContaining({ source: 'handbook', target: 'policy', kind: 'markdown_link' }),
      expect.objectContaining({ source: 'policy', target: 'tag:hr', kind: 'tag' }),
    ]));
    expect(graph.edges.filter((edge) => edge.source === 'policy' && edge.target === 'handbook' && edge.kind === 'markdown_link')).toHaveLength(1);
    expect(graph.unresolvedLinks).toEqual([{ source: 'policy', target: 'missing.md', label: 'Missing' }]);
  });

  it('builds an app knowledge map from knowledge cards', () => {
    const graph = knowledgeItemsToLinkGraph([
      {
        id: 'k1',
        title: 'Policy',
        summary: '',
        contentMarkdown: 'See [Handbook](ops/k2.md).',
        department: '총무팀',
        category: 'ops',
        freshness: 'latest',
        usageCount: 0,
        modCount: 0,
        sourceLabel: 'seed',
        authorName: '이지수',
        updatedAtLabel: '오늘',
        aiTags: ['ops'],
      },
      {
        id: 'k2',
        title: 'Handbook',
        summary: '',
        contentMarkdown: '# Handbook',
        department: '총무팀',
        category: 'ops',
        freshness: 'latest',
        usageCount: 0,
        modCount: 0,
        sourceLabel: 'seed',
        authorName: '이지수',
        updatedAtLabel: '오늘',
        aiTags: ['ops'],
      },
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'k1', target: 'k2' })]));
  });

  it('writes a self-contained visualization html file', async () => {
    const root = join(tmpdir(), `wkf-viz-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    await writeConcept(
      root,
      'policy.md',
      `---
type: POLICY
title: Policy
tags: []
---
# Summary
`,
    );
    const outputPath = join(root, 'viz.html');
    const graph = await writeKnowledgeMapHtml(root, outputPath);
    const html = await readFile(outputPath, 'utf8');
    expect(graph.nodes).toHaveLength(1);
    expect(html).toContain('지식 맵');
    expect(html).toContain('const graph =');
  });
});
