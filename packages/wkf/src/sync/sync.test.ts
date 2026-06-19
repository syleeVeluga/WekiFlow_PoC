import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { initBundle, JsonDocumentSource, pullBundle, readManifest, slugToBundlePath, statusBundle } from '../index.js';

async function tempDir(): Promise<string> {
  const root = join(tmpdir(), `wkf-sync-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

describe('bundle sync', () => {
  it('initializes a bundle manifest and state', async () => {
    const root = await tempDir();
    await initBundle(root);

    await expect(readFile(join(root, 'wkf.yaml'), 'utf8')).resolves.toContain('wkf_version');
    await expect(readManifest(root)).resolves.toMatchObject({ scope: root });
    await expect(readFile(join(root, '.wkf', 'state.json'), 'utf8')).resolves.toContain('"entries"');
  });

  it('rejects slugs that escape the bundle root', () => {
    expect(() => slugToBundlePath('knowledge', '../outside')).toThrow('Invalid WKF slug path');
    expect(() => slugToBundlePath('knowledge', 'hr/annual-leave')).not.toThrow();
  });

  it('pulls published documents and records baseRev idempotently', async () => {
    const root = await tempDir();
    const sourcePath = join(root, 'documents.json');
    await initBundle(root);
    await writeFile(
      sourcePath,
      JSON.stringify({
        documents: [
          { title: 'Annual Leave', slug: 'hr/annual-leave', status: 'PUBLISHED', contentMarkdown: 'Policy body' },
          { title: 'Draft', slug: 'hr/draft', status: 'DRAFT', contentMarkdown: 'No' },
        ],
      }),
      'utf8',
    );

    const first = await pullBundle(root, new JsonDocumentSource(sourcePath));
    const second = await pullBundle(root, new JsonDocumentSource(sourcePath));

    expect(first.written).toEqual(['hr/annual-leave.md']);
    expect(second.state.entries['hr/annual-leave']?.baseRev).toBe(first.state.entries['hr/annual-leave']?.baseRev);
    await expect(readFile(join(root, 'hr', 'annual-leave.md'), 'utf8')).resolves.toContain('Policy body');
  });

  it('reports modified and clean bundle files', async () => {
    const root = await tempDir();
    const sourcePath = join(root, 'documents.json');
    await initBundle(root);
    await writeFile(
      sourcePath,
      JSON.stringify([{ title: 'Annual Leave', slug: 'hr/annual-leave', status: 'PUBLISHED', contentMarkdown: 'Policy body' }]),
      'utf8',
    );
    await pullBundle(root, new JsonDocumentSource(sourcePath));

    expect(await statusBundle(root)).toContainEqual(expect.objectContaining({ status: 'clean', path: 'hr/annual-leave.md' }));
    await writeFile(join(root, 'hr', 'annual-leave.md'), 'changed', 'utf8');
    expect(await statusBundle(root)).toContainEqual(expect.objectContaining({ status: 'modified', path: 'hr/annual-leave.md' }));
  });

  it('supports pull dry runs without writing files or state', async () => {
    const root = await tempDir();
    const sourcePath = join(root, 'documents.json');
    await initBundle(root);
    await writeFile(sourcePath, JSON.stringify([{ title: 'Annual Leave', status: 'PUBLISHED', contentMarkdown: 'Policy body' }]), 'utf8');

    const result = await pullBundle(root, new JsonDocumentSource(sourcePath), { dryRun: true });
    expect(result.written).toEqual(['annual-leave.md']);
    await expect(readFile(join(root, 'annual-leave.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await statusBundle(root)).toEqual([]);
  });
});
