import fs from "fs/promises";
import path from "path";

const TMP_ROOT = path.resolve(process.cwd(), "tmp", "sessions");
const DB_FILE = path.resolve(process.cwd(), "tmp", "db.json");

async function readDb() {
  try {
    const txt = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    return { sessions: [], chunks: [], summaries: [] };
  }
}

async function writeDb(obj) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(obj, null, 2), "utf8");
}

async function updateChunkText(sessionId, filename, text) {
  const db = await readDb();
  for (let c of db.chunks) {
    if (c.sessionId === sessionId && c.filename === filename) {
      c.text = text;
    }
  }
  await writeDb(db);
}

async function createSummary(summary) {
  const db = await readDb();
  db.summaries.unshift(summary);
  await writeDb(db);
}

async function updateSession(sessionId, patch) {
  const db = await readDb();
  const idx = db.sessions.findIndex((s) => s.id === sessionId);
  if (idx !== -1) {
    db.sessions[idx] = { ...db.sessions[idx], ...patch };
    await writeDb(db);
  }
}

/**
 * Mock transcription worker.
 * - Reads chunk files from tmp/sessions/<sessionId>
 * - For each chunk creates a dummy transcript text and updates TranscriptChunk.text
 * - Creates a Summary row with an aggregate placeholder summary
 *
 * This is a stand-in for the real Gemini integration. Replace the internals
 * with actual calls to the Gemini API or a real STT pipeline later.
 */
export async function transcribeSession(sessionId) {
  const sessionDir = path.join(TMP_ROOT, sessionId);
  try {
    const useReal = (process.env.ENABLE_REAL_TRANSCRIPTION === '1' || process.env.ENABLE_REAL_TRANSCRIPTION === 'true');
    const provider = (process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION || 'mock').toLowerCase();
    let realClient = null;
    let providerName = 'mock';
    if (useReal) {
      try {
        providerName = provider;
        // Use an eval-based dynamic import helper to avoid static bundler resolution
        const tryImport = async (pkg) => {
          try {
            // eval('import(...)') prevents static analysis from bundlers like Next
            // eslint-disable-next-line no-eval
            return await eval(`import("${pkg}")`);
          } catch (e) {
            return null;
          }
        };

        if (provider === 'gemini' || provider === 'google') {
          const gan = await tryImport('@google/generative-ai');
          if (gan) {
            const key = process.env.GEMINI_API_KEY || process.env.GENERATIVE_AI_KEY || process.env.GOOGLE_API_KEY;
            const TextServiceClient = gan.TextServiceClient || gan.default?.TextServiceClient || gan.TextClient;
            if (TextServiceClient) {
              try {
                realClient = new TextServiceClient({ key });
                console.log('transcription-worker: initialized Gemini/Google generative client');
              } catch (e) {
                console.warn('transcription-worker: could not construct TextServiceClient directly - storing module for call-time use', String(e));
                realClient = gan;
              }
            } else {
              console.warn('transcription-worker: @google/generative-ai present but TextServiceClient not found');
              realClient = gan; // keep module for potential alternative calls
            }
          } else {
            console.warn('transcription-worker: @google/generative-ai not installed; skipping real transcription');
            realClient = null;
          }
        } else if (provider === 'openai') {
          const OpenAI = await tryImport('openai');
          if (OpenAI) {
            const key = process.env.OPENAI_API_KEY;
            const Client = OpenAI.default || OpenAI.OpenAI;
            if (Client) {
              try {
                realClient = new Client({ apiKey: key });
                console.log('transcription-worker: initialized OpenAI client');
              } catch (e) {
                console.warn('transcription-worker: failed to instantiate OpenAI client', String(e));
                realClient = null;
              }
            } else {
              console.warn('transcription-worker: openai package loaded but client constructor not found');
              realClient = null;
            }
          } else {
            console.warn('transcription-worker: openai package not installed; skipping real transcription');
            realClient = null;
          }
        } else {
          console.warn('transcription-worker: ENABLE_REAL_TRANSCRIPTION set but unsupported TRANSCRIPTION_PROVIDER', provider);
        }
      } catch (e) {
        console.warn('transcription-worker: error while preparing real client, using mock', String(e));
      }
    }
    const entries = await fs.readdir(sessionDir);
    const chunkFiles = entries.filter((f) => f.toLowerCase().endsWith(".webm")).sort();

    // Per-chunk transcription (real client if available, otherwise mock)
    const transcripts = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const filename = chunkFiles[i];
      // read file size to include in mock text
      let stats;
      try {
        stats = await fs.stat(path.join(sessionDir, filename));
      } catch (e) {
        stats = { size: 0 };
      }
      let text = `Transcribed (mock) for ${filename} — size ${stats.size} bytes`;
      if (realClient) {
        try {
          if (providerName === 'gemini' || providerName === 'google') {
            // Attempt to perform audio transcription using available methods.
            // Read the audio file bytes and try common method names across versions.
            const filePath = path.join(sessionDir, filename);
            let audioBuf = null;
            try {
              audioBuf = await fs.readFile(filePath);
            } catch (e) {
              console.warn('transcription-worker: failed to read audio file for real transcription', filePath, String(e));
            }

            if (audioBuf) {
              // Helper: try a direct HTTP-based transcription endpoint if configured.
              const tryHttpTranscribe = async (url, key, buf) => {
                try {
                  const b64 = Buffer.from(buf).toString('base64');
                  const body = JSON.stringify({
                    audio: { content: b64 },
                    config: { encoding: 'WEBM_OPUS', languageCode: process.env.TRANSCRIPTION_LANG || 'en-US' }
                  });
                  const resp = await fetch(url, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${key}`
                    },
                    body
                  }).catch(() => null);
                  if (!resp) return null;
                  const json = await resp.json().catch(() => null);
                  if (!json) return null;
                  // Try common response shapes
                  if (typeof json.transcript === 'string') return json.transcript;
                  if (json.results && json.results[0] && json.results[0].alternatives && json.results[0].alternatives[0] && json.results[0].alternatives[0].transcript) {
                    return String(json.results[0].alternatives[0].transcript);
                  }
                  if (json.outputText) return String(json.outputText);
                  if (json.text) return String(json.text);
                  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                    // generative responses sometimes return nested content
                    const c = json.candidates[0].content;
                    if (Array.isArray(c) && c[0] && c[0].text) return String(c[0].text);
                    if (typeof c === 'string') return c;
                  }
                  return null;
                } catch (e) {
                  return null;
                }
              };

              // Try a few candidate APIs in order, guarded in try/catch
              // 1) If client exposes a method to accept raw audio (e.g., transcribe, recognize)
              try {
                if (typeof realClient.transcribe === 'function') {
                  const resp = await realClient.transcribe({ audio: audioBuf, mimeType: 'audio/webm' }).catch(() => null);
                  if (resp && resp.text) text = String(resp.text).slice(0, 2000);
                }
              } catch (e) {
                /* ignore */
              }

              // 2) If client has a recognize or speech.recognize pattern
              try {
                if (realClient.speech && typeof realClient.speech.recognize === 'function') {
                  const resp = await realClient.speech.recognize({ audio: audioBuf }).catch(() => null);
                  if (resp && resp.results && resp.results[0] && resp.results[0].alternatives && resp.results[0].alternatives[0]) {
                    text = String(resp.results[0].alternatives[0].transcript).slice(0, 2000);
                  }
                }
              } catch (e) {
                /* ignore */
              }

              // 3) If module is @google/generative-ai but we only have TextServiceClient or a module export,
              //    fallback to a safe generate-text placeholder using a short prompt (no audio upload).
              try {
                if (typeof realClient.generateText === 'function') {
                  const request = { model: process.env.GENERATIVE_MODEL || 'gpt-4o-mini', input: `Transcribe audio file ${filename} (file size ${audioBuf.length} bytes)` };
                  const resp = await realClient.generateText(request).catch(() => null);
                  if (resp && resp?.candidates && resp.candidates[0] && resp.candidates[0].content) {
                    text = String(resp.candidates[0].content).slice(0, 2000);
                  } else if (resp && resp.text) {
                    text = String(resp.text).slice(0, 2000);
                  }
                }
              } catch (e) {
                /* ignore */
              }

              // 4) If user configured a direct Gemini-compatible HTTP transcription endpoint,
              //    attempt to POST the audio as base64 to that URL using `GEMINI_TRANSCRIBE_URL`.
              try {
                const httpUrl = process.env.GEMINI_TRANSCRIBE_URL || process.env.GENERATIVE_TRANSCRIBE_URL;
                const apiKey = process.env.GEMINI_API_KEY || process.env.GENERATIVE_AI_KEY || process.env.GOOGLE_API_KEY;
                if (!text && httpUrl && apiKey) {
                  const hres = await tryHttpTranscribe(httpUrl, apiKey, audioBuf);
                  if (hres) {
                    text = String(hres).slice(0, 2000);
                  }
                }
              } catch (e) {
                /* ignore */
              }
            } else {
              text = `Transcribed (remote placeholder) for ${filename}`;
            }
          } else if (providerName === 'openai') {
            // For OpenAI, try a simple completion call (guarded)
            if (typeof realClient.responses === 'object' && typeof realClient.responses.create === 'function') {
              const resp = await realClient.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', input: `Transcribe audio file ${filename}` }).catch(() => null);
              if (resp && resp.output && resp.output[0] && resp.output[0].content) {
                text = String(resp.output[0].content[0]?.text || resp.output[0].content[0]?.markdown || '').slice(0, 2000) || text;
              }
            } else {
              text = `Transcribed (remote placeholder) for ${filename}`;
            }
          }
        } catch (e) {
          console.warn('transcription-worker: real transcription failed, using mock for', filename, String(e));
        }
      }

      // update TranscriptChunk entry by filename
      await updateChunkText(sessionId, filename, text);

      transcripts.push(text);
    }

    const aggregate = transcripts.join("\n\n");
    const summaryText = `Summary (mock): ${transcripts.length} chunks processed.`;

    // create a summary row
    await createSummary({ sessionId: sessionId, text: summaryText, createdAt: new Date().toISOString() });

    // mark session completed and attach simple transcript in the session record
    await updateSession(sessionId, { status: "COMPLETED", transcript: aggregate });

    return { success: true };
  } catch (err) {
    console.error("transcribeSession failed", err);
    // mark session errored
    try {
      await updateSession(sessionId, { status: "ERROR" });
    } catch (e) {
      console.error('failed to mark session ERROR in JSON DB', e);
    }
    throw err;
  }
}
