import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DockerSandboxRunner } from '@wf/sandbox';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
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
  const grep = await sandbox.run({
    language: 'bash',
    code: 'rg -n "제4조 2항" /docs',
    docsSnapshotDir: dir,
    timeoutMs: 10_000,
  });

  if (grep.exitCode !== 0 || !grep.stdout.includes('연차 15일')) {
    console.error(grep);
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

  console.log(grep.stdout.trim());
  console.log(
    'Sandbox grep PoC passed: rg found the exact line; network, read-only mount, memory limit, and cleanup checks passed',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
