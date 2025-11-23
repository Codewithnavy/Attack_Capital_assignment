import { createServer } from 'http';

const PORT = process.env.PORT || process.env.GEMINI_PROXY_PORT || 4010;
const UPSTREAM = process.env.GEMINI_UPSTREAM_URL || process.env.GEMINI_TRANSCRIBE_URL_UPSTREAM || null;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_AI_KEY || null;

function jsonResponse(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return jsonResponse(res, 200, { ok: true });

    if (req.method === 'POST' && req.url === '/transcribe') {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (!body) return jsonResponse(res, 400, { error: 'missing body' });
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return jsonResponse(res, 400, { error: 'invalid json' }); }
      const audio = parsed.audio && parsed.audio.content;
      const bufLen = audio ? Buffer.from(audio, 'base64').length : 0;

      if (UPSTREAM && API_KEY) {
        try {
          const r = await fetch(UPSTREAM, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }, body: JSON.stringify(parsed) });
          const j = await r.json().catch(() => null);
          if (j && typeof j === 'object') {
            if (j.transcript || j.text || j.outputText) return jsonResponse(res, 200, { transcript: j.transcript || j.text || j.outputText });
            if (j.results && j.results[0] && j.results[0].alternatives && j.results[0].alternatives[0] && j.results[0].alternatives[0].transcript) return jsonResponse(res, 200, { transcript: j.results[0].alternatives[0].transcript });
            if (j.candidates && j.candidates[0] && j.candidates[0].content) return jsonResponse(res, 200, { transcript: String(j.candidates[0].content) });
          }
          return jsonResponse(res, 200, { transcript: JSON.stringify(j) });
        } catch (e) {
          return jsonResponse(res, 502, { error: 'upstream failed', detail: String(e) });
        }
      }

      return jsonResponse(res, 200, { transcript: `Synthetic transcript for ${bufLen} bytes (proxy)` });
    }

    jsonResponse(res, 404, { error: 'not found' });
  } catch (e) {
    jsonResponse(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`gemini-proxy listening on ${PORT} (UPSTREAM=${UPSTREAM ? 'set' : 'none'})`);
});
