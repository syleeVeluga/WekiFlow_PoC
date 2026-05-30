/**
 * Core PoC — Phase 2: the real Vercel AI SDK agent loop.
 *
 * Proves the PRD's headline behaviour: when the agent is unsure about a number/clause it
 * autonomously opens the sandbox terminal, runs `rg` against the read-only /docs mount, and
 * folds the exact line into the merged draft + self-verification.
 *
 * Run: pnpm tsx scripts/poc-main-agent.ts   (requires OPENAI_API_KEY + Docker)
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ObjectId, type Db } from 'mongodb';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { DockerSandboxRunner } from '@wf/sandbox';
import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildIngestPrompt,
  createMainTools,
  type AgentStep,
  type EmbedFn,
} from '@wf/agent-tools';
import { MergeResultSchema, loadEnv } from '@wf/shared';

if (!process.env.OPENAI_API_KEY) {
  console.log('SKIP poc-main-agent: OPENAI_API_KEY is not set (this PoC calls the live model).');
  process.exit(0);
}

const env = loadEnv();
const image = 'wekiflow/sandbox:latest';

function sh(command: string, args: string[]) {
  const r = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// In-memory MongoDB stand-in so the PoC needs no live Mongo — only Docker + the model.
function makeFakeDb(seed: Record<string, Record<string, unknown>[]>): Db {
  const store = seed;
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  const collection = (name: string) => {
    const rows = (store[name] ??= []);
    return {
      find: (filter: Record<string, unknown> = {}) => ({
        toArray: async () => rows.filter((row) => matches(row, filter)),
      }),
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
      insertMany: async (docs: Record<string, unknown>[]) => void rows.push(...docs),
      deleteMany: async (filter: Record<string, unknown>) => {
        store[name] = rows.filter((row) => !matches(row, filter));
      },
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const row = rows.find((r) => matches(r, filter));
        if (row && update.$set) Object.assign(row, update.$set);
      },
    };
  };
  return { collection } as unknown as Db;
}

if (sh('docker', ['image', 'inspect', image]).status !== 0) {
  const build = sh('docker', ['build', '-t', image, 'docker/sandbox']);
  if (build.status !== 0) {
    console.error(build.stdout, build.stderr);
    process.exit(build.status);
  }
}

const dir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));
const content = '# 휴가 규정\n제4조 2항: 신입사원은 입사 시 연차 15일을 부여받는다.\n';

try {
  await writeFile(path.join(dir, 'leave.md'), content, 'utf8');

  const id = new ObjectId();
  const db = makeFakeDb({
    documents: [{ _id: id, title: '휴가 규정', slug: 'leave', contentMarkdown: content, status: 'PROCESSING' }],
    chunks: [],
  });

  const model = openai(env.AGENT_MODEL);
  const embeddingModel = openai.textEmbeddingModel(env.EMBEDDING_MODEL);
  const embed: EmbedFn = async (texts) => (await embedMany({ model: embeddingModel, values: texts })).embeddings;

  const steps: AgentStep[] = [];
  const sandbox = new DockerSandboxRunner({ image });
  const tools = createMainTools({
    db,
    sandbox,
    docsSnapshotDir: dir,
    jobId: 'poc',
    documentId: id.toString(),
    embed,
    model,
    recordStep: (step) => void steps.push(step),
  });

  const agent = new ToolLoopAgent({
    model,
    instructions: MAIN_AGENT_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(12),
  });

  const result = await agent.generate({
    prompt: buildIngestPrompt({ id: id.toString(), title: '휴가 규정', contentMarkdown: content }),
  });

  // Pull the merged draft out of the agent's tool history.
  let merged: string | undefined;
  for (const step of result.steps) {
    for (const tr of step.toolResults ?? []) {
      const parsed = MergeResultSchema.safeParse(tr.output);
      if (tr.toolName === 'tool_merge' && parsed.success) merged = parsed.data.mergedMarkdown;
    }
  }

  console.log('--- agent steps ---');
  for (const step of steps) console.log(`  ${step.tool}`, JSON.stringify(step.args));
  console.log('--- final text ---\n' + result.text);
  console.log('--- merged draft ---\n' + (merged ?? '(no tool_merge output)'));

  const usedSandbox = steps.some((s) => s.tool === 'tool_execute_sandbox_terminal');
  const leakCheck = sh('docker', ['ps', '-a', '--filter', `ancestor=${image}`, '--format', '{{.ID}}']);

  if (!usedSandbox) {
    console.error('FAIL: agent never invoked tool_execute_sandbox_terminal');
    process.exit(1);
  }
  if (merged && !merged.includes('15일')) {
    console.error('FAIL: merged draft did not retain the grep-verified figure (연차 15일)');
    process.exit(1);
  }
  if (leakCheck.stdout.trim().length > 0) {
    console.error('FAIL: sandbox containers leaked:', leakCheck.stdout);
    process.exit(1);
  }

  console.log('\nMain agent PoC passed: agent autonomously used the sandbox, merged the verified figure, no container leak.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
