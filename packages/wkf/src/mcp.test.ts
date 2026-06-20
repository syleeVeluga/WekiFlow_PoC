import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleWkfMcpRequest, listMcpConcepts, lookupMcpConcept, proposeMcpChange } from './mcp.js';

async function bundle(): Promise<string> {
  const root = join(tmpdir(), `wkf-mcp-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'policy.md'),
    `---
type: POLICY
title: Leave Policy
slug: leave-policy
tags: [hr]
---
# Facts
Annual leave is reviewed by HR.
`,
    'utf8',
  );
  return root;
}

describe('wkf mcp', () => {
  it('lists and looks up WKF concepts without writing', async () => {
    const root = await bundle();

    await expect(listMcpConcepts(root)).resolves.toEqual([
      { slug: 'leave-policy', path: 'policy.md', title: 'Leave Policy', type: 'POLICY' },
    ]);
    await expect(lookupMcpConcept(root, 'leave-policy')).resolves.toMatchObject({
      concept: { slug: 'leave-policy' },
      markdown: expect.stringContaining('# Facts'),
    });
  });

  it('queues proposed changes instead of modifying the concept file', async () => {
    const root = await bundle();
    const before = await readFile(join(root, 'policy.md'), 'utf8');
    const proposal = await proposeMcpChange(
      root,
      { slug: 'leave-policy', instruction: 'Clarify reviewer role.', rationale: 'MCP client suggestion' },
      { now: new Date('2026-06-20T00:00:00.000Z') },
    );

    expect(proposal).toMatchObject({ slug: 'leave-policy', status: 'REVIEW' });
    await expect(readFile(join(root, 'policy.md'), 'utf8')).resolves.toBe(before);
    await expect(readFile(join(root, '.wkf', 'mcp-proposals.jsonl'), 'utf8')).resolves.toContain('Clarify reviewer role.');
  });

  it('exposes MCP tools/list and tools/call handlers', async () => {
    const root = await bundle();
    await expect(handleWkfMcpRequest(root, { method: 'tools/list' })).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('lookup_concept') }],
    });
    await expect(
      handleWkfMcpRequest(root, {
        method: 'tools/call',
        params: { name: 'lookup_concept', arguments: { slug: 'leave-policy' } },
      }),
    ).resolves.toMatchObject({ content: [{ text: expect.stringContaining('Leave Policy') }] });
  });

  it('requires a token for tool calls when auth is configured', async () => {
    const root = await bundle();
    await expect(
      handleWkfMcpRequest(
        root,
        {
          method: 'tools/call',
          params: { name: 'list_concepts', arguments: {} },
        },
        { authToken: 'secret' },
      ),
    ).rejects.toThrow('MCP token is required');
    await expect(
      handleWkfMcpRequest(
        root,
        {
          method: 'tools/call',
          params: { name: 'list_concepts', arguments: { token: 'secret' } },
        },
        { authToken: 'secret' },
      ),
    ).resolves.toMatchObject({ content: [{ text: expect.stringContaining('leave-policy') }] });
  });
});
