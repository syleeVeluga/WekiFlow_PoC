#!/usr/bin/env node
import { initBundle } from './sync/init.js';
import { MongoClient } from 'mongodb';
import { pushBundle } from './sync/push.js';
import { reindexBundle } from './reindex.js';
import { referenceBundle } from './sync/reference.js';
import { pullBundle } from './sync/pull.js';
import { JsonDocumentSource, JsonDocumentStore } from './sync/source.js';
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
    if (arg === '--source' || arg === '--slug' || arg === '--concept' || arg === '--mongo-uri' || arg === '--db' || arg === '--embedding-model') {
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

  if (command === 'push') {
    const sourcePath = optionValue(args, '--source') ?? process.env.WKF_PULL_SOURCE;
    if (!sourcePath) throw new Error('wkf push requires --source <documents.json> or WKF_PULL_SOURCE');
    const result = await pushBundle(bundleArg(args), new JsonDocumentStore(sourcePath), {
      force: hasFlag(args, '--force'),
      validateOnly: hasFlag(args, '--validate-only') || dryRun,
    });
    if (hasFlag(args, '--validate-only') || dryRun) {
      console.log(result.checked.length === 0 ? 'nothing to validate' : `validated\n${result.checked.join('\n')}`);
    } else {
      console.log(result.pushed.length === 0 ? 'nothing to push' : result.pushed.join('\n'));
    }
    return;
  }

  if (command === 'reference') {
    const sourcePath = optionValue(args, '--source') ?? process.env.WKF_PULL_SOURCE;
    const slug = optionValue(args, '--slug');
    if (!sourcePath) throw new Error('wkf reference requires --source <documents.json> or WKF_PULL_SOURCE');
    if (!slug || slug.startsWith('--')) throw new Error('wkf reference requires --slug <slug>');
    const result = await referenceBundle(bundleArg(args), new JsonDocumentStore(sourcePath), slug);
    console.log(result.path);
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

  if (command === 'reindex') {
    const mongoUri = optionValue(args, '--mongo-uri') ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
    const dbName = optionValue(args, '--db') ?? process.env.MONGODB_DB ?? 'wekiflow';
    const client = new MongoClient(mongoUri);
    try {
      await client.connect();
      const concept = optionValue(args, '--concept');
      const embeddingModel = optionValue(args, '--embedding-model') ?? process.env.EMBEDDING_MODEL;
      const result = await reindexBundle(client.db(dbName), bundleArg(args), {
        all: hasFlag(args, '--all'),
        ...(concept ? { concept } : {}),
        ...(embeddingModel ? { embeddingModel } : {}),
      });
      console.log(`reindexed ${result.concepts.length} concepts, ${result.chunkCount} chunks, ${result.relationCount} relations`);
    } finally {
      await client.close();
    }
    return;
  }

  throw new Error('Usage: wkf <init|pull|status|push|reference|reindex> [bundlePath] [--dry-run] [--source documents.json]');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
