import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectId, type Db } from 'mongodb';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { MockLanguageModelV3, mockValues } from 'ai/test';
import { createMainTools, type AgentStep } from '@wf/agent-tools';
import { DockerSandboxRunner } from '@wf/sandbox';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function makeFakeDb(): Db {
  return {
    collection() {
      return {
        find: () => ({ toArray: async () => [] }),
        findOne: async () => null,
        insertMany: async () => undefined,
        deleteMany: async () => undefined,
        updateOne: async () => undefined,
      };
    },
  } as unknown as Db;
}

const image = 'wekiflow/sandbox:latest';
const imageInspect = run('docker', ['image', 'inspect', image]);
if (imageInspect.status !== 0) {
  const build = run('docker', ['build', '-t', image, 'docker/sandbox']);
  if (build.status !== 0) {
    console.error(build.stdout);
    console.error(build.stderr);
    process.exit(build.status);
  }
}

const dir = await mkdtemp(path.join(tmpdir(), 'wf-docs-'));

try {
  await writeFile(
    path.join(dir, 'leave.md'),
    '# 휴가 규정\n제4조 2항: 신입사원은 입사 시 연차 15일을 부여받는다.\n',
    'utf8',
  );

  const sandbox = new DockerSandboxRunner({ image });
  const steps: AgentStep[] = [];
  const tools = createMainTools({
    db: makeFakeDb(),
    sandbox,
    docsSnapshotDir: dir,
    jobId: 'poc-sandbox-grep',
    documentId: new ObjectId().toHexString(),
    embed: async (texts) => texts.map(() => [1, 0]),
    model: {} as never,
    recordStep: (step) => void steps.push(step),
  });

  const agent = new ToolLoopAgent({
    model: new MockLanguageModelV3({
      doGenerate: mockValues(
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'grep-1',
              toolName: 'tool_execute_sandbox_terminal',
              input: JSON.stringify({
                language: 'bash',
                code: 'rg -n -F -- "제4조 2항" /docs',
                timeoutMs: 10_000,
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
        {
          content: [{ type: 'text', text: '제4조 2항에 따르면 신입사원은 연차 15일을 부여받는다.' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        },
      ),
    } as never),
    instructions: '확실치 않으면 tool_execute_sandbox_terminal로 rg를 실행해 원문을 직접 확인하라.',
    tools: { tool_execute_sandbox_terminal: tools.tool_execute_sandbox_terminal },
    stopWhen: stepCountIs(5),
  });

  const result = await agent.generate({
    prompt: '제4조 2항에서 신입사원이 부여받는 연차 일수를 원문에서 정확히 확인해줘.',
  });
  const toolResult = result.steps
    .flatMap((step) => step.toolResults ?? [])
    .find((entry) => entry.toolName === 'tool_execute_sandbox_terminal')?.output as
    | { stdout?: string; exitCode?: number }
    | undefined;

  if (!steps.some((step) => step.tool === 'tool_execute_sandbox_terminal') || !toolResult) {
    console.error({ text: result.text, steps });
    process.exit(1);
  }

  if (toolResult.exitCode !== 0 || !toolResult.stdout?.includes('연차 15일')) {
    console.error({ result: result.text, toolResult, steps });
    process.exit(1);
  }

  const network = await sandbox.run({
    language: 'python',
    code: "import urllib.request; urllib.request.urlopen('https://example.com', timeout=3)",
    docsSnapshotDir: dir,
    timeoutMs: 8_000,
  });

  if (network.exitCode === 0) {
    console.error('Expected network-disabled sandbox command to fail');
    process.exit(1);
  }

  const readOnlyMount = await sandbox.run({
    language: 'bash',
    code: 'touch /docs/should-not-write',
    docsSnapshotDir: dir,
    timeoutMs: 8_000,
  });

  if (readOnlyMount.exitCode === 0) {
    console.error('Expected /docs read-only mount write to fail');
    process.exit(1);
  }

  const memoryLimit = await sandbox.run({
    language: 'python',
    code: 'data = bytearray(512 * 1024 * 1024); print(len(data))',
    docsSnapshotDir: dir,
    timeoutMs: 10_000,
  });

  if (memoryLimit.exitCode === 0) {
    console.error('Expected memory-limited sandbox command to fail');
    process.exit(1);
  }

  const remaining = run('docker', [
    'ps',
    '-a',
    '--filter',
    `ancestor=${image}`,
    '--format',
    '{{.ID}}',
  ]);

  if (remaining.stdout.trim().length > 0) {
    console.error('Expected no remaining sandbox containers');
    console.error(remaining.stdout);
    process.exit(1);
  }

  console.log(toolResult.stdout.trim());
  console.log(result.text);
  console.log(
    'Sandbox grep PoC passed: the agent called the sandbox rg tool; network, read-only mount, memory limit, and cleanup checks passed',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
