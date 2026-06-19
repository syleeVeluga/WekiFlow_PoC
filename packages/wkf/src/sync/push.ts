import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromMongo } from '../fromMongo.js';
import { readState, writeState } from '../manifest.js';
import { parse } from '../parse.js';
import { enforcePolicy, loadPolicy } from '../policy.js';
import { serialize } from '../serialize.js';
import { validate } from '../validate.js';
import { contentHash } from './hash.js';
import { statusBundle, type StatusEntry } from './status.js';
import type { MongoWkfDocument } from '../types.js';
import type { WkfDocumentStore } from './source.js';

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly slug: string,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface PushOptions {
  force?: boolean;
  validateOnly?: boolean;
}

export interface PushResult {
  checked: string[];
  pushed: string[];
  conflicts: string[];
}

function remoteContentHash(remote: MongoWkfDocument | undefined): string | undefined {
  if (!remote) return undefined;
  if (typeof remote.contentHash === 'string' && remote.contentHash) return remote.contentHash;
  return contentHash(serialize(fromMongo(remote)));
}

function changed(entries: StatusEntry[]): StatusEntry[] {
  return entries.filter((entry) => entry.status === 'modified');
}

export async function pushBundle(bundlePath: string, store: WkfDocumentStore, options: PushOptions = {}): Promise<PushResult> {
  const validation = await validate(bundlePath);
  if (!validation.ok) {
    throw new Error(`WKF validation failed: ${validation.issues.filter((issue) => issue.level === 'error').map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }

  const state = await readState(bundlePath);
  const policy = await loadPolicy(bundlePath);
  const checked: string[] = [];
  const pushed: string[] = [];
  const conflicts: string[] = [];

  for (const entry of changed(await statusBundle(bundlePath))) {
    checked.push(entry.path);
    const remote = await store.getBySlug(entry.slug);
    const remoteRev = remoteContentHash(remote);
    if (remoteRev && remoteRev !== entry.baseRev && !options.force) {
      conflicts.push(entry.slug);
      continue;
    }

    const markdown = await readFile(join(bundlePath, entry.path), 'utf8');
    const doc = parse(markdown);
    enforcePolicy('commit', doc, policy);
    const nextHash = contentHash(markdown);
    const nextRemote: MongoWkfDocument = {
      title: doc.frontmatter.title,
      slug: entry.slug,
      status: doc.frontmatter.status ?? 'PUBLISHED',
      contentMarkdown: doc.body.trimEnd(),
      contentHash: nextHash,
    };

    if (!options.validateOnly) {
      await store.upsert(nextRemote);
      state.entries[entry.slug] = { ...state.entries[entry.slug]!, baseRev: nextHash };
      pushed.push(entry.path);
    }
  }

  if (conflicts.length > 0) throw new ConflictError(`Remote changed after pull: ${conflicts.join(', ')}`, conflicts[0]!);
  if (!options.validateOnly) await writeState(bundlePath, state);
  return { checked, pushed, conflicts };
}
