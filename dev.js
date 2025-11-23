#!/usr/bin/env node
// Lightweight dev wrapper so `npx run dev --port 3001` works in local shells.
// It launches the project's Next dev server with NEXT_DISABLE_ESLINT=1 and honors --port

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
let port = process.env.PORT || '3001';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' && args[i + 1]) {
    port = String(args[i + 1]);
    break;
  }
  if (a.startsWith('--port=')) {
    port = a.split('=')[1];
    break;
  }
}

const nextCli = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');
const nodeExe = process.execPath;

const env = Object.assign({}, process.env, {
  NEXT_DISABLE_ESLINT: '1',
  PORT: port,
});

console.log(`Starting Next dev on port ${port} (via dev.js)`);

const child = spawn(nodeExe, [nextCli, 'dev', '-p', port], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code === null ? 1 : code);
});

child.on('error', (err) => {
  console.error('Failed to start Next dev:', err);
  process.exit(1);
});
