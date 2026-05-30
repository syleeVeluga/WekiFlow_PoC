import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SandboxRunResultSchema, type SandboxRunResult } from '@wf/shared';

export interface SandboxRunner {
  run(input: {
    language: 'bash' | 'python';
    code: string;
    docsSnapshotDir: string;
    timeoutMs: number;
  }): Promise<SandboxRunResult>;
}

export interface DockerSandboxRunnerOptions {
  image?: string;
  outputLimitBytes?: number;
  audit?: (entry: {
    image: string;
    command: string[];
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    mounts: Array<{ source: string; target: string; ro: boolean }>;
  }) => void | Promise<void>;
}

export class DockerSandboxRunner implements SandboxRunner {
  private readonly image: string;
  private readonly outputLimitBytes: number;
  private readonly audit?: DockerSandboxRunnerOptions['audit'];

  constructor(options: DockerSandboxRunnerOptions = {}) {
    this.image = options.image ?? 'wekiflow/sandbox:latest';
    this.outputLimitBytes = options.outputLimitBytes ?? 64 * 1024;
    this.audit = options.audit;
  }

  async run(input: {
    language: 'bash' | 'python';
    code: string;
    docsSnapshotDir: string;
    timeoutMs: number;
  }): Promise<SandboxRunResult> {
    const command =
      input.language === 'python' ? ['python', '-c', input.code] : ['bash', '-lc', input.code];
    const containerName = `wf-sandbox-${randomUUID()}`;

    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      'none',
      '--read-only',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--pids-limit',
      '128',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '1000:1000',
      '--tmpfs',
      '/work:rw,size=64m,mode=1777',
      '--tmpfs',
      '/tmp:rw,size=16m',
      '-v',
      `${input.docsSnapshotDir}:/docs:ro`,
      '-w',
      '/work',
      this.image,
      ...command,
    ];

    const startedAt = Date.now();
    const result = await runDocker(args, input.timeoutMs, this.outputLimitBytes, containerName);
    await this.audit?.({
      image: this.image,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      mounts: [{ source: input.docsSnapshotDir, target: '/docs', ro: true }],
    });
    return result;
  }
}

export async function runDocker(
  args: string[],
  timeoutMs: number,
  outputLimitBytes: number,
  cleanupContainerName?: string,
): Promise<SandboxRunResult> {
  return await new Promise((resolve) => {
    const child = spawn('docker', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stdout.length + stderr.length + text.length > outputLimitBytes) {
        truncated = true;
        return;
      }
      if (target === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stderr += `Timed out after ${timeoutMs}ms`;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      void (async () => {
        if (timedOut && cleanupContainerName) {
          await forceRemoveContainer(cleanupContainerName);
        }
        resolve(SandboxRunResultSchema.parse({ stdout, stderr, exitCode: code ?? 1, truncated }));
      })();
    });
  });
}

async function forceRemoveContainer(containerName: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const cleanup = spawn('docker', ['rm', '-f', containerName], { windowsHide: true });
    cleanup.on('close', () => resolve());
    cleanup.on('error', () => resolve());
  });
}
