const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const nextBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next'
);

const processes = [];

function spawnProcess(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env },
  });
  processes.push({ name, child });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
      shutdown(code || 1);
      return;
    }
  });
}

function shutdown(exitCode = 0) {
  processes.forEach(({ child }) => {
    try {
      child.kill('SIGINT');
    } catch {}
  });
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

spawnProcess('next', nextBin, ['dev', '-p', '4545']);
spawnProcess('live-feed', 'node', [path.join(root, 'live-feed-server.js')]);
