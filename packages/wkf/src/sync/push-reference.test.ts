import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConflictError, initBundle, JsonDocumentSource, JsonDocumentStore, pullBundle, pushBundle, referenceBundle } from '../index.js';

async function setupBundle() {
  const root = join(tmpdir(), `wkf-push-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const sourcePath = join(root, 'documents.json');
  await writeFile(
    sourcePath,
    JSON.stringify({
      documents: [{ title: 'Annual Leave', slug: 'hr/annual-leave', status: 'PUBLISHED', contentMarkdown: 'Policy body' }],
    }),
    'utf8',
  );
  await initBundle(root);
  const store = new JsonDocumentStore(sourcePath);
  await pullBundle(root, new JsonDocumentSource(sourcePath));
  return { root, sourcePath, store, docPath: join(root, 'hr', 'annual-leave.md') };
}

describe('pushBundle', () => {
  it('pushes local changes and updates baseRev', async () => {
    const { root, sourcePath, store, docPath } = await setupBundle();
    await writeFile(
      docPath,
      `---
type: ENTITY
title: Annual Leave
tags: []
status: PUBLISHED
slug: hr/annual-leave
---
Changed policy body`,
      'utf8',
    );

    await expect(pushBundle(root, store)).resolves.toMatchObject({ pushed: ['hr/annual-leave.md'] });
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain('Changed policy body');
  });

  it('blocks conflicts unless force is set', async () => {
    const { root, sourcePath, store, docPath } = await setupBundle();
    const remote = JSON.parse(await readFile(sourcePath, 'utf8')) as { documents: Array<Record<string, unknown>> };
    remote.documents[0]!.contentHash = 'remote-changed';
    await writeFile(sourcePath, JSON.stringify(remote), 'utf8');
    await writeFile(docPath, (await readFile(docPath, 'utf8')).replace('Policy body', 'Local body'), 'utf8');

    await expect(pushBundle(root, store)).rejects.toBeInstanceOf(ConflictError);
    await expect(pushBundle(root, store, { force: true })).resolves.toMatchObject({ pushed: ['hr/annual-leave.md'] });
  });

  it('validate-only checks but does not write remote changes', async () => {
    const { root, sourcePath, store, docPath } = await setupBundle();
    await writeFile(docPath, (await readFile(docPath, 'utf8')).replace('Policy body', 'Validate only body'), 'utf8');

    await expect(pushBundle(root, store, { validateOnly: true })).resolves.toMatchObject({ checked: ['hr/annual-leave.md'], pushed: [] });
    await expect(readFile(sourcePath, 'utf8')).resolves.not.toContain('Validate only body');
  });
});

describe('referenceBundle', () => {
  it('writes a read-only marked reference document', async () => {
    const { root, store } = await setupBundle();
    const result = await referenceBundle(root, store, 'hr/annual-leave');
    const refPath = join(root, result.path);

    await expect(readFile(refPath, 'utf8')).resolves.toContain('WKF reference: read-only');
    expect((await stat(refPath)).mode & 0o222).toBe(0);
    await expect(pushBundle(root, store)).resolves.toMatchObject({ checked: [] });
  });
});
