import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
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

(async () => {
  const sessionId = `test-${Date.now().toString(36)}`;
  const port = await getFreePort();
  const proxyUrl = `http://127.0.0.1:${port}`;

  const proxy = spawn(process.execPath, ['./server/gemini-proxy.js'], {
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proxy.stdout.on('data', (d) => process.stdout.write(String(d)));
  proxy.stderr.on('data', (d) => process.stderr.write(String(d)));

  // wait for proxy to start
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy start timeout')), 5000);
    function onData(d) {
      const s = String(d);
      if (s.includes('gemini-proxy listening')) {
        clearTimeout(timer);
        proxy.stdout.off('data', onData);
        resolve();
      }
    }
    proxy.stdout.on('data', onData);
  });

  // prepare tmp session and chunk
  const sessionDir = path.join(process.cwd(), 'tmp', 'sessions', sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  const chunkPath = path.join(sessionDir, 'chunk-0001.webm');
  await fs.writeFile(chunkPath, Buffer.from('RIFF....fakewebm....'));

  // run transcribe worker pointing at the proxy
  console.log('Running transcribe worker for', sessionId);
  const runner = spawn(process.execPath, ['./server/run-transcribe.js', sessionId], {
    env: { ...process.env, ENABLE_REAL_TRANSCRIPTION: '1', TRANSCRIPTION_PROVIDER: 'gemini', GEMINI_TRANSCRIBE_URL: `${proxyUrl}/transcribe`, GEMINI_API_KEY: 'dummy' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  runner.stdout.on('data', (d) => { out += String(d); process.stdout.write(String(d)); });
  runner.stderr.on('data', (d) => { process.stderr.write(String(d)); });

  const code = await new Promise((resolve) => runner.on('close', resolve));

  // inspect db.json
  const dbPath = path.join(process.cwd(), 'tmp', 'db.json');
  const dbtxt = await fs.readFile(dbPath, 'utf8').catch(() => null);
  const db = dbtxt ? JSON.parse(dbtxt) : null;

  // cleanup
  try { proxy.kill(); } catch (e) {}

  if (code !== 0) {
    console.error('transcribe worker failed with code', code);
    process.exit(2);
  }

  if (!db) {
    console.error('db.json not created');
    process.exit(2);
  }

  const summaries = (db.summaries || []).filter((s) => s.sessionId === sessionId);
  if (summaries.length === 0) {
    console.error('no summary created for session', sessionId);
    process.exit(2);
  }

  console.log('worker-transcribe: success for', sessionId);
  process.exit(0);
})();
