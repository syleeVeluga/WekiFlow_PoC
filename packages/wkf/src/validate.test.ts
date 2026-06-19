import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertNoShrinkage, validate, ValidationError } from './index.js';
import type { WkfDoc } from './types.js';

async function makeBundle(files: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `wkf-${randomUUID()}`);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  return root;
}

const before: WkfDoc = {
  frontmatter: { type: 'REGULATION', resource: 'wekiflow://hr/leave', tags: ['hr'] },
  body: `# Overview
Body

# Schema
- \`days\` NUMBER: leave days

# Citations
1. Source
`,
};

describe('validate', () => {
  it('rejects concept documents without frontmatter type', async () => {
    const root = await makeBundle({ 'bad.md': '---\ntitle: Bad\n---\nBody' });
    const result = await validate(root);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.rule)).toContain('frontmatter-parseable');
  });

  it('allows broken links and warns on reserved structure only', async () => {
    const root = await makeBundle({
      'index.md': 'not a generated index',
      'policy.md': `---
type: CUSTOM
---
See [missing](/missing.md)
`,
    });
    const result = await validate(root);
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ level: 'warning', rule: 'reserved-index-structure' }));
  });

  it('enforces citation policy by type', async () => {
    const root = await makeBundle({
      'policy.yaml': 'citations:\n  required_for: [REGULATION]\n',
      'leave.md': `---
type: REGULATION
---
No citations
`,
    });
    const result = await validate(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'citations-required' }));
  });
});

describe('assertNoShrinkage', () => {
  it('allows additive changes', () => {
    expect(() =>
      assertNoShrinkage(before, {
        frontmatter: { type: 'REGULATION', resource: 'wekiflow://hr/leave', tags: ['hr', 'policy'] },
        body: `${before.body}\n# Extra\nMore detail\n`,
      }),
    ).not.toThrow();
  });

  it('rejects heading deletion, schema shrinkage, citation shrinkage, and tag drops', () => {
    expect(() => assertNoShrinkage(before, { ...before, body: before.body.replace('# Overview\n', '') })).toThrow(ValidationError);
    expect(() => assertNoShrinkage(before, { ...before, body: before.body.replace('- `days` NUMBER: leave days\n', '') })).toThrow(
      ValidationError,
    );
    expect(() => assertNoShrinkage(before, { ...before, body: before.body.replace('1. Source\n', '') })).toThrow(ValidationError);
    expect(() =>
      assertNoShrinkage(before, {
        ...before,
        frontmatter: { type: 'REGULATION', resource: 'wekiflow://hr/leave', tags: [] },
      }),
    ).toThrow(ValidationError);
  });
});
