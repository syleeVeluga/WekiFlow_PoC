#!/usr/bin/env node
import { initBundle } from './sync/init.js';
import { pullBundle } from './sync/pull.js';
import { JsonDocumentSource } from './sync/source.js';
import { statusBundle } from './sync/status.js';

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function bundleArg(args: string[]): string {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--source') {
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) positionals.push(arg);
  }
  return positionals[0] ?? 'knowledge';
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const dryRun = hasFlag(args, '--dry-run');

  if (command === 'init') {
    const planned = await initBundle(bundleArg(args), { dryRun });
    console.log(dryRun ? planned.join('\n') : `initialized ${bundleArg(args)}`);
    return;
  }

  if (command === 'pull') {
    const sourcePath = optionValue(args, '--source') ?? process.env.WKF_PULL_SOURCE;
    if (!sourcePath) throw new Error('wkf pull requires --source <documents.json> or WKF_PULL_SOURCE');
    const result = await pullBundle(bundleArg(args), new JsonDocumentSource(sourcePath), { dryRun });
    console.log(result.written.length === 0 ? 'no published documents' : result.written.join('\n'));
    return;
  }

  if (command === 'status') {
    const entries = await statusBundle(bundleArg(args));
    if (entries.length === 0) {
      console.log('clean');
      return;
    }
    for (const entry of entries) console.log(`${entry.status}\t${entry.path}`);
    return;
  }

  throw new Error('Usage: wkf <init|pull|status> [bundlePath] [--dry-run] [--source documents.json]');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
