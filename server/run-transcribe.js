import fs from 'fs';
import path from 'path';

function loadDotEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    // ignore missing .env
  }
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env');
  loadDotEnv(envPath);

  const sessionId = process.argv[2] || '418da986-27c1-4aa0-a7e7-90f59470c100';

  try {
    const { transcribeSession } = await import('./transcription-worker.js');
    console.log('Starting transcription for', sessionId, ' (ENABLE_REAL_TRANSCRIPTION=', process.env.ENABLE_REAL_TRANSCRIPTION ? 'true' : 'false', ')');
    const res = await transcribeSession(sessionId);
    console.log('Transcription finished for', sessionId, 'result:', res);
    process.exit(0);
  } catch (err) {
    console.error('transcription run failed', err && err.message ? err.message : err);
    process.exit(2);
  }
}

main();
