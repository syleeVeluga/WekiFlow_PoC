import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fromMongo } from '../fromMongo.js';
import { readManifest } from '../manifest.js';
import { serialize } from '../serialize.js';
import { slugToBundlePath } from './paths.js';
import type { WkfDocumentStore } from './source.js';

export interface ReferenceResult {
  path: string;
}

export async function referenceBundle(bundlePath: string, store: WkfDocumentStore, slug: string): Promise<ReferenceResult> {
  const manifest = await readManifest(bundlePath);
  const remote = await store.getBySlug(slug);
  if (!remote) throw new Error(`No remote document found for ${slug}`);

  const refRoot = join(bundlePath, manifest.reference?.path ?? '.ref');
  const path = slugToBundlePath(refRoot, slug);
  const markdown = `<!-- WKF reference: read-only -->\n${serialize(fromMongo({ ...remote, slug }))}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, 'utf8');
  await chmod(path, 0o444).catch(() => undefined);
  return { path: relative(bundlePath, path).replaceAll('\\', '/') };
}
