import { spawn } from 'node:child_process';

const host = process.argv[2] ?? '127.0.0.1';
const port = process.argv[3] ?? '5173';
const apiURL = process.argv[4] ?? 'http://127.0.0.1:4100';

const env = {
  ...process.env,
  VITE_API_URL: apiURL,
};
const args = ['pnpm', '--filter', '@wf/web', 'exec', 'vite', '--host', host, '--port', port, '--strictPort'];
const command = `corepack ${args.join(' ')}`;

const child = process.platform === 'win32' ? spawn('cmd.exe', ['/d', '/s', '/c', command], {
  env,
  stdio: 'inherit',
}) : spawn('corepack', args, {
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
