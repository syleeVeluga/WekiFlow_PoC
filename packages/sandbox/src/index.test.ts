import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SandboxRunResultSchema } from '@wf/shared';
import { runDocker } from './index.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('@wf/sandbox', () => {
  it('validates sandbox run output shape', () => {
    expect(
      SandboxRunResultSchema.parse({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        truncated: false,
      }).stdout,
    ).toBe('ok');
  });

  it('force removes named containers when docker run times out', async () => {
    const dockerRun = createChild();
    const dockerRm = createChild();
    vi.mocked(spawn)
      .mockReturnValueOnce(dockerRun as never)
      .mockReturnValueOnce(dockerRm as never);

    const resultPromise = runDocker(['run', '--name', 'wf-sandbox-test'], 1, 1024, 'wf-sandbox-test');

    setTimeout(() => {
      dockerRun.emit('close', 1);
      dockerRm.emit('close', 0);
    }, 5);

    const result = await resultPromise;

    expect(result.stderr).toContain('Timed out after 1ms');
    expect(spawn).toHaveBeenLastCalledWith(
      'docker',
      ['rm', '-f', 'wf-sandbox-test'],
      { windowsHide: true },
    );
  });
});

function createChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}
