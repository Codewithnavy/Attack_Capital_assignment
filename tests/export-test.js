const PORT = process.env.SOCKET_PORT || '4001';
const SESSION_ID = process.env.SESSION_ID || '1cfb8f41-6e9d-4da4-98d8-0e03be51a995';

async function run() {
  console.log('Testing exports for session', SESSION_ID);
  const formats = ['txt','srt','json'];
  for (const f of formats) {
    const url = `http://127.0.0.1:${PORT}/sessions/${SESSION_ID}/export?format=${f}`;
    console.log('GET', url);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error('FAILED', f, 'status', res.status);
        process.exit(2);
      }
      const ct = res.headers.get('content-type') || '';
      console.log('OK', f, 'content-type', ct);
      const txt = await res.text();
      console.log('BODY:', txt.slice(0,200).replace(/\n/g,' '));
    } catch (e) {
      console.error('error fetching', url, String(e));
      process.exit(2);
    }
  }
  console.log('export-test: success');
  process.exit(0);
}

run();
