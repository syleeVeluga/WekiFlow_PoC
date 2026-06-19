import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { fromMongo } from '../fromMongo.js';
import { readState, writeState, type WkfState } from '../manifest.js';
import { serialize } from '../serialize.js';
import { contentHash } from './hash.js';
import { slugFromDocument, slugToBundlePath } from './paths.js';
import type { WkfDocumentSource } from './source.js';

export interface PullOptions {
  dryRun?: boolean;
}

export interface PullResult {
  written: string[];
  state: WkfState;
}

export async function pullBundle(bundlePath: string, source: WkfDocumentSource, options: PullOptions = {}): Promise<PullResult> {
  const state = await readState(bundlePath);
  const written: string[] = [];

  for (const remote of await source.listPublished()) {
    const slug = slugFromDocument(remote);
    const markdown = serialize(fromMongo({ ...remote, slug }));
    const path = slugToBundlePath(bundlePath, slug);
    const baseRev = contentHash(markdown);
    const relativePath = relative(bundlePath, path).replaceAll('\\', '/');
    written.push(relativePath);
    state.entries[slug] = { slug, path: relativePath, baseRev };

    if (!options.dryRun) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, markdown, 'utf8');
    }
  }

  if (!options.dryRun) await writeState(bundlePath, state);
  return { written, state };
}
