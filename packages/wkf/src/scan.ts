import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse } from './parse.js';
import { defaultPolicy, type Policy } from './policy.js';

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);

export interface ScanStaleOptions {
  now?: Date;
  limit?: number;
}

export interface StaleConcept {
  slug: string;
  path: string;
  type: string;
  lastCheckedAt?: string;
  staleSince: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

async function listConceptFiles(bundlePath: string, dir = bundlePath): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.wkf' || entry.name === 'references') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listConceptFiles(bundlePath, path)));
    if (entry.isFile() && entry.name.endsWith('.md') && !RESERVED_MARKDOWN.has(entry.name)) files.push(path);
  }
  return files.sort((a, b) => normalizePath(relative(bundlePath, a)).localeCompare(normalizePath(relative(bundlePath, b))));
}

function freshnessDays(policy: Policy, type: string): number {
  const raw = policy.freshness[type] ?? policy.freshness.default;
  const match = /^(\d+)d$/.exec(raw);
  if (!match) throw new Error(`Unsupported freshness value: ${raw}`);
  return Number(match[1]);
}

function slugFromPath(bundlePath: string, path: string): string {
  return normalizePath(relative(bundlePath, path)).replace(/\.md$/i, '');
}

export async function scanStale(bundlePath: string, policy: Policy = defaultPolicy, options: ScanStaleOptions = {}): Promise<StaleConcept[]> {
  const now = options.now ?? new Date();
  const stale: StaleConcept[] = [];

  for (const file of await listConceptFiles(bundlePath)) {
    const path = normalizePath(relative(bundlePath, file));
    const doc = parse(await readFile(file, 'utf8'));
    const checked = doc.frontmatter.last_verified ?? doc.frontmatter.timestamp;
    const checkedTime = checked ? new Date(checked).getTime() : Number.NaN;
    const maxAgeMs = freshnessDays(policy, doc.frontmatter.type) * 24 * 60 * 60 * 1000;
    if (Number.isFinite(checkedTime) && now.getTime() - checkedTime <= maxAgeMs) continue;
    stale.push({
      slug: doc.frontmatter.slug ?? slugFromPath(bundlePath, file),
      path,
      type: doc.frontmatter.type,
      ...(checked ? { lastCheckedAt: checked } : {}),
      staleSince: new Date(Number.isFinite(checkedTime) ? checkedTime + maxAgeMs : 0).toISOString(),
    });
    if (options.limit && stale.length >= options.limit) break;
  }

  return stale;
}
