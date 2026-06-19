import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultManifest, writeManifest, writeState } from '../manifest.js';

export interface InitOptions {
  dryRun?: boolean;
}

export async function initBundle(bundlePath: string, options: InitOptions = {}): Promise<string[]> {
  const planned = [join(bundlePath, 'wkf.yaml'), join(bundlePath, 'index.md'), join(bundlePath, 'log.md'), join(bundlePath, '.wkf', 'state.json')];
  if (options.dryRun) return planned;

  await mkdir(bundlePath, { recursive: true });
  await writeManifest(bundlePath, defaultManifest(bundlePath));
  await writeFile(join(bundlePath, 'index.md'), '# WekiFlow Knowledge Bundle\n', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await writeFile(join(bundlePath, 'log.md'), '', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await writeState(bundlePath, { entries: {} });
  return planned;
}
