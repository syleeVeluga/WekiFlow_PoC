import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fromMongo } from '../fromMongo.js';
import { appendLog } from '../log.js';
import { readState, writeState } from '../manifest.js';
import { parse } from '../parse.js';
import { enforcePolicy, loadPolicy } from '../policy.js';
import { serialize } from '../serialize.js';
import { validate } from '../validate.js';
import { assertNoShrinkage } from '../guardrails.js';
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

function isCurationRemote(remote: MongoWkfDocument): boolean {
  if (!Array.isArray(remote.sourceRefs)) return false;
  return remote.sourceRefs.some((sourceRef) => {
    if (!sourceRef || typeof sourceRef !== 'object') return false;
    const raw = sourceRef as Record<string, unknown>;
    return String(raw.note ?? '').includes('curation') || String(raw.ref ?? '').startsWith('wkf://');
  });
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
    if (remote && isCurationRemote(remote)) {
      const before = fromMongo(remote);
      if (before.frontmatter.type.toLowerCase() !== 'reference' && doc.frontmatter.type.toLowerCase() !== 'reference') {
        assertNoShrinkage(before, doc);
      }
    }
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
      await appendLog(join(bundlePath, dirname(entry.path)), {
        kind: remote ? 'Update' : 'Creation',
        slug: basename(entry.path),
        summary: remote ? 'WKF push 승인 변경 반영' : 'WKF push 최초 등록',
        actor: 'wkf',
        pipeline: 'A',
      });
      state.entries[entry.slug] = { ...state.entries[entry.slug]!, baseRev: nextHash };
      pushed.push(entry.path);
    }
  }

  if (conflicts.length > 0) throw new ConflictError(`Remote changed after pull: ${conflicts.join(', ')}`, conflicts[0]!);
  if (!options.validateOnly) await writeState(bundlePath, state);
  return { checked, pushed, conflicts };
}
