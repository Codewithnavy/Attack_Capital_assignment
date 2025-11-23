import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

const PORT = process.env.PORT || process.env.GEMINI_PROXY_PORT || 4010;
const UPSTREAM = process.env.GEMINI_UPSTREAM_URL || process.env.GEMINI_TRANSCRIBE_URL_UPSTREAM || null;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GENERATIVE_AI_KEY || null;

app.post('/transcribe', async (req, res) => {
  try {
    const body = req.body || {};
    const audio = body.audio && body.audio.content;
    const bufLen = audio ? Buffer.from(audio, 'base64').length : 0;

    if (UPSTREAM && API_KEY) {
      // forward to upstream provider
      try {
        const r = await fetch(UPSTREAM, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`
          },
          body: JSON.stringify(body)
        });
        const j = await r.json().catch(() => null);
        // Normalize common shapes
        if (j && typeof j === 'object') {
          if (j.transcript || j.text || j.outputText) return res.json({ transcript: j.transcript || j.text || j.outputText });
          if (j.results && j.results[0] && j.results[0].alternatives && j.results[0].alternatives[0] && j.results[0].alternatives[0].transcript) {
            return res.json({ transcript: j.results[0].alternatives[0].transcript });
          }
          if (j.candidates && j.candidates[0] && j.candidates[0].content) {
            return res.json({ transcript: String(j.candidates[0].content) });
          }
        }
        return res.json({ transcript: JSON.stringify(j) });
      } catch (e) {
        return res.status(502).json({ error: 'upstream failed', detail: String(e) });
      }
    }

    // Default: synthetic transcript for local testing
    return res.json({ transcript: `Synthetic transcript for ${bufLen} bytes (proxy)` });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`gemini-proxy listening on ${PORT} (UPSTREAM=${UPSTREAM ? 'set' : 'none'})`);
});
