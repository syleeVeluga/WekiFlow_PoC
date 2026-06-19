import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateIndexes } from './index-gen.js';

async function tempBundle(): Promise<string> {
  const root = join(tmpdir(), `wkf-index-${randomUUID()}`);
  await mkdir(join(root, 'hr', 'leave'), { recursive: true });
  await mkdir(join(root, 'empty'), { recursive: true });
  await writeFile(
    join(root, 'hr', 'annual-leave.md'),
    `---
type: REGULATION
title: Annual Leave
description: Leave policy
---
# Body
`,
    'utf8',
  );
  await writeFile(
    join(root, 'hr', 'onboarding.md'),
    `---
type: PLAYBOOK
title: Onboarding
description: New hire onboarding
---
# Body
`,
    'utf8',
  );
  await writeFile(
    join(root, 'hr', 'leave', 'special-leave.md'),
    `---
type: POLICY
title: Special Leave
description: Special leave rules
---
# Body
`,
    'utf8',
  );
  return root;
}

describe('generateIndexes', () => {
  it('generates grouped index files and skips empty directories', async () => {
    const root = await tempBundle();
    const result = await generateIndexes(root);

    expect(result.written.sort()).toEqual(['hr/index.md', 'hr/leave/index.md', 'index.md']);
    await expect(readFile(join(root, 'index.md'), 'utf8')).resolves.toBe(
      '# Subdirectories\n* [hr](hr/index.md)\n',
    );
    await expect(readFile(join(root, 'hr', 'index.md'), 'utf8')).resolves.toBe(
      '# Subdirectories\n* [leave](leave/index.md) - Special leave rules\n\n# PLAYBOOK\n* [Onboarding](onboarding.md) - New hire onboarding\n\n# REGULATION\n* [Annual Leave](annual-leave.md) - Leave policy\n',
    );
    await expect(readFile(join(root, 'empty', 'index.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is idempotent and reports check drift without writing', async () => {
    const root = await tempBundle();
    await generateIndexes(root);
    expect(await generateIndexes(root)).toMatchObject({ written: [] });

    await writeFile(join(root, 'hr', 'index.md'), 'stale\n', 'utf8');
    const checked = await generateIndexes(root, { check: true });
    expect(checked.drifted).toEqual(['hr/index.md']);
    await expect(readFile(join(root, 'hr', 'index.md'), 'utf8')).resolves.toBe('stale\n');
  });

  it('removes stale indexes from directories that become empty', async () => {
    const root = await tempBundle();
    await generateIndexes(root);
    await rm(join(root, 'hr', 'leave', 'special-leave.md'));

    const checked = await generateIndexes(root, { check: true });
    expect(checked.drifted).toContain('hr/leave/index.md');
    await expect(readFile(join(root, 'hr', 'leave', 'index.md'), 'utf8')).resolves.toContain('Special Leave');

    const result = await generateIndexes(root);
    expect(result.written).toContain('hr/leave/index.md');
    await expect(readFile(join(root, 'hr', 'leave', 'index.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
