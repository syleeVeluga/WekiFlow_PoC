import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify, parseDocument } from 'yaml';

export interface WkfManifest {
  wkf_version: string;
  scope: string;
  snapshot: {
    documents: string;
  };
  publishing: {
    documents: string;
  };
  reference: {
    path: string;
  };
}

export interface WkfStateEntry {
  slug: string;
  path: string;
  baseRev: string;
}

export interface WkfState {
  entries: Record<string, WkfStateEntry>;
}

export function defaultManifest(scope = 'knowledge'): WkfManifest {
  return {
    wkf_version: '0.1',
    scope,
    snapshot: { documents: 'PUBLISHED' },
    publishing: { documents: 'PUBLISHED' },
    reference: { path: '.ref' },
  };
}

export function manifestPath(bundlePath: string): string {
  return join(bundlePath, 'wkf.yaml');
}

export function statePath(bundlePath: string): string {
  return join(bundlePath, '.wkf', 'state.json');
}

export async function writeManifest(bundlePath: string, manifest = defaultManifest()): Promise<void> {
  await mkdir(bundlePath, { recursive: true });
  await writeFile(manifestPath(bundlePath), stringify(manifest, { lineWidth: 0 }), 'utf8');
}

export async function readManifest(bundlePath: string): Promise<WkfManifest> {
  const parsed = parseDocument(await readFile(manifestPath(bundlePath), 'utf8'), { strict: true });
  if (parsed.errors.length > 0) throw new Error(`Invalid wkf.yaml: ${parsed.errors[0]!.message}`);
  return parsed.toJSON() as WkfManifest;
}

export async function readState(bundlePath: string): Promise<WkfState> {
  try {
    return JSON.parse(await readFile(statePath(bundlePath), 'utf8')) as WkfState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: {} };
    throw error;
  }
}

export async function writeState(bundlePath: string, state: WkfState): Promise<void> {
  const path = statePath(bundlePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
