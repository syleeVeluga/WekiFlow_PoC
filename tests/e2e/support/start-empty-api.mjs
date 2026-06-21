import { spawn } from 'node:child_process';

const host = process.argv[2] ?? '127.0.0.1';
const port = process.argv[3] ?? '4100';

const command = 'corepack pnpm exec tsx tests/e2e/support/empty-api.ts';
const env = {
  ...process.env,
  PLAYWRIGHT_HOST: host,
  PLAYWRIGHT_API_PORT: port,
};

const child = process.platform === 'win32' ? spawn('cmd.exe', ['/d', '/s', '/c', command], {
  env,
  stdio: 'inherit',
}) : spawn('corepack', ['pnpm', 'exec', 'tsx', 'tests/e2e/support/empty-api.ts'], {
  env,
  stdio: 'inherit',
});

function stop(signal) {
  child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
