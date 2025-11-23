import { spawn } from 'child_process';
// Use global fetch available in Node 18+/20+ runtime

// Start the socket server as a child process, wait for listening log, then probe /health and /sessions
const SERVER_FILE = './server/socket-server.js';

// Find an available port by asking the OS (listen on 0), then close and use it.
import net from 'net';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const p = (addr && typeof addr === 'object') ? addr.port : addr;
      srv.close(() => resolve(String(p)));
    });
    srv.on('error', reject);
  });
}

let PORT = process.env.SOCKET_PORT || null;

function waitForServer(child, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout waiting for server to start'));
    }, timeout);

    function onData(data) {
      const s = String(data);
      process.stdout.write(s);
      if (s.includes(`Socket server listening on port ${PORT}`)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve();
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => process.stderr.write(String(d)));
  });
}

(async () => {
  try {
    if (!PORT) PORT = await getFreePort();
  } catch (e) {
    console.error('failed to acquire free port', e && e.message ? e.message : e);
    process.exit(2);
  }

  const child = spawn(process.execPath, [SERVER_FILE], {
    env: { ...process.env, SOCKET_PORT: PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child, 10000);

    // probe /health
    const h = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (!h.ok) throw new Error('/health returned non-200');
    const hj = await h.json();
    if (!hj.ok) throw new Error('/health did not return ok');

    // probe /sessions (should return ok with array)
    const s = await fetch(`http://127.0.0.1:${PORT}/sessions`);
    if (!s.ok) throw new Error('/sessions returned non-200');
    const sj = await s.json();
    if (!('ok' in sj)) throw new Error('/sessions missing ok');
    if (!Array.isArray(sj.data)) throw new Error('/sessions data is not array');

    console.log('smoke-socket: success');
    // kill child
    child.kill();
    process.exit(0);
  } catch (e) {
    console.error('smoke-socket error', e && e.message ? e.message : e);
    try { child.kill(); } catch (err) { /* ignore */ }
    process.exit(2);
  }
})();
