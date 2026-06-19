import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readState } from '../manifest.js';
import { contentHash, rawContentHash } from './hash.js';

export interface StatusEntry {
  slug: string;
  path: string;
  status: 'clean' | 'modified' | 'missing';
  baseRev: string;
  currentRev?: string;
}

export async function statusBundle(bundlePath: string): Promise<StatusEntry[]> {
  const state = await readState(bundlePath);
  const entries: StatusEntry[] = [];

  for (const entry of Object.values(state.entries).sort((a, b) => a.slug.localeCompare(b.slug))) {
    try {
      const markdown = await readFile(join(bundlePath, entry.path), 'utf8');
      const currentRev = safeContentHash(markdown);
      entries.push({
        slug: entry.slug,
        path: entry.path,
        status: currentRev === entry.baseRev ? 'clean' : 'modified',
        baseRev: entry.baseRev,
        currentRev,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entries.push({ slug: entry.slug, path: entry.path, status: 'missing', baseRev: entry.baseRev });
        continue;
      }
      throw error;
    }
  }

  return entries;
}

function safeContentHash(markdown: string): string {
  try {
    return contentHash(markdown);
  } catch {
    return rawContentHash(markdown);
  }
}
