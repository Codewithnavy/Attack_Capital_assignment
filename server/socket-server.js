/**
 * Simple Socket.io server to receive audio chunks from clients.
 * - Receives events: 'start-session', 'audio-chunk', 'end-session'
 * - Stores incoming binary chunks on disk under ./tmp/sessions/<sessionId>/
 * - Emits status updates: 'recording', 'processing', 'completed'
 *
 * This is intentionally minimal for the assignment prototype. In production,
 * you'd forward chunks to a transcription pipeline (e.g. Gemini streaming)
 * and handle auth, scaling, and resilience.
 */

import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";

// Use installed @prisma/client at runtime for Node server processes.
// Importing the generated client in Next app routes caused bundler issues;
// the server runs in Node and can safely use the package entrypoint.
// Lightweight JSON-backed store used for local development to avoid Prisma
// runtime issues in the dev environment. This keeps the prototype runnable
// without a Postgres instance. For production, swap back to Prisma calls.
import fsPromises from "fs/promises";
const DB_FILE = path.resolve(process.cwd(), "tmp", "db.json");

async function readDb() {
  try {
    const txt = await fsPromises.readFile(DB_FILE, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    return { sessions: [], chunks: [], summaries: [] };
  }
}

async function writeDb(obj) {
  await fsPromises.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fsPromises.writeFile(DB_FILE, JSON.stringify(obj, null, 2), "utf8");
}

// convenience helpers (minimal semantics)
async function dbCreateSession(s) {
  const db = await readDb();
  db.sessions.unshift(s);
  await writeDb(db);
}

async function dbFindSessions() {
  const db = await readDb();
  return db.sessions;
}

async function dbCreateChunk(chunk) {
  const db = await readDb();
  db.chunks.push(chunk);
  await writeDb(db);
}

async function dbFindChunks(sessionId) {
  const db = await readDb();
  return db.chunks.filter((c) => c.sessionId === sessionId).sort((a,b)=>a.index-b.index);
}

async function dbCreateSummary(summary) {
  const db = await readDb();
  db.summaries.unshift(summary);
  await writeDb(db);
}

async function dbFindSummaries(sessionId) {
  const db = await readDb();
  return db.summaries.filter((s) => s.sessionId === sessionId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}

async function dbUpdateSessionStatus(sessionId, status, patch = {}) {
  const db = await readDb();
  const idx = db.sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;
  db.sessions[idx] = { ...db.sessions[idx], status, ...patch };
  await writeDb(db);
  return db.sessions[idx];
}

// Transcription worker (mock)
import { transcribeSession } from "./transcription-worker.js";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const TMP_ROOT = path.resolve(process.cwd(), "tmp", "sessions");

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Accept a few different binary shapes that can arrive over Socket.io
function toBuffer(blob) {
  if (!blob) return Buffer.alloc(0);
  // Node Buffer
  if (Buffer.isBuffer(blob)) return blob;
  // Raw ArrayBuffer
  if (blob instanceof ArrayBuffer) return Buffer.from(blob);
  // TypedArray (Uint8Array, etc.)
  if (ArrayBuffer.isView(blob)) return Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  // Socket.io / structured clone may wrap Buffer as { type: 'Buffer', data: [...] }
  if (typeof blob === "object") {
    if (Array.isArray(blob.data)) return Buffer.from(blob.data);
    if (blob.buffer && blob.buffer instanceof ArrayBuffer) return Buffer.from(blob.buffer);
  }
  // fallback: try Buffer.from on the value (will throw on unsupported types)
  return Buffer.from(blob);
}

const SOCKET_PORT = process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 4001;
httpServer.listen(SOCKET_PORT, () => {
  console.log(`Socket server listening on port ${SOCKET_PORT}`);
});

// Surface uncaught errors to console so the process doesn't silently exit
process.on('uncaughtException', (err) => {
  console.error('uncaughtException in socket-server', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection in socket-server', reason);
});

// In some environments the process can exit if there are no active handles
// (e.g. when socket.io isn't holding a handle). Keep a lightweight interval
// to ensure the process remains alive while the server is running.
setInterval(() => {}, 1e6);

// Basic HTTP API for sessions so the Next app can fetch session data
// without importing the Prisma client (avoids bundler issues).
httpServer.on('request', async (req, res) => {
  try {
    // GET /sessions -> list sessions
      // req.url can be a full URL or a path. Provide a safe fallback.
      const base = `http://localhost:${SOCKET_PORT}`;
      const rawUrl = req.url || '/';
      const u = new URL(rawUrl, base);
      // GET /sessions -> list
      if (u.pathname === '/sessions' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        const sessions = await dbFindSessions();
        const results = await Promise.all(
          sessions.map(async (s) => {
            const chunks = await dbFindChunks(s.id);
            const summaries = await dbFindSummaries(s.id);
            return { session: s, chunks, summaries };
          })
        );
        res.end(JSON.stringify({ ok: true, data: results }));
        return;
      }

      // GET /sessions/:id -> details
      const sessionMatch = u.pathname.match(/^\/sessions\/([^\/]+)$/);
      if (sessionMatch && req.method === 'GET') {
        const sessionId = sessionMatch[1];
        res.setHeader('Content-Type', 'application/json');
        const db = await readDb();
        const session = db.sessions.find((s) => s.id === sessionId);
        if (!session) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, error: 'session not found' }));
          return;
        }
        const chunks = await dbFindChunks(sessionId);
        const summaries = await dbFindSummaries(sessionId);
        res.end(JSON.stringify({ ok: true, data: { session, chunks, summaries } }));
        return;
      }

      // GET /sessions/:id/export?format=txt|srt|json
      const exportMatch = u.pathname.match(/^\/sessions\/([^\/]+)\/export$/);
      if (exportMatch && req.method === 'GET') {
        const sessionId = exportMatch[1];
        const format = (u.searchParams.get('format') || 'txt').toLowerCase();
        const chunks = await dbFindChunks(sessionId);
        const summaries = await dbFindSummaries(sessionId);

        if (format === 'json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, data: { sessionId, chunks, summaries } }));
          return;
        }

        // aggregate chunk texts
        const texts = chunks.map((c) => c.text || '').join('\n\n');
        if (format === 'txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="session-${sessionId}.txt"`);
          res.end(texts);
          return;
        }

        if (format === 'srt') {
          // Generate a simple SRT using chunk indices (no real timestamps available)
          const srtLines = [];
          for (let i = 0; i < chunks.length; i++) {
            const idx = i + 1;
            // crude timestamp: each chunk gets 00:00:00,000 → 00:00:30,000 windows
            const startSec = i * 30;
            const endSec = startSec + 30;
            const fmt = (s) => {
              const hh = String(Math.floor(s / 3600)).padStart(2, '0');
              const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
              const ss = String(s % 60).padStart(2, '0');
              return `${hh}:${mm}:${ss},000`;
            };
            srtLines.push(String(idx));
            srtLines.push(`${fmt(startSec)} --> ${fmt(endSec)}`);
            srtLines.push(chunks[i].text || '');
            srtLines.push('');
          }
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="session-${sessionId}.srt"`);
          res.end(srtLines.join('\n'));
          return;
        }
      }

      // Health check
      if (u.pathname === '/health' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, now: new Date().toISOString() }));
        return;
      }

    
  } catch (err) {
    console.error('socket-server /sessions error', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err) }));
    return;
  }
});

io.on("connection", (socket) => {
  console.log("client connected", socket.id);

  socket.on("start-session", async ({ sessionId }) => {
    try {
      console.log("start-session", sessionId);
      const sessionDir = path.join(TMP_ROOT, sessionId);
      ensureDirSync(sessionDir);

      // create a session record in the lightweight DB
      await dbCreateSession({
        id: sessionId,
        title: `Session ${sessionId}`,
        status: "RECORDING",
        createdAt: new Date().toISOString(),
      });

      socket.emit("session-started", { sessionId });
    } catch (err) {
      console.error("start-session error", err);
      socket.emit("error", { message: "start-session failed" });
    }
  });

  socket.on("audio-chunk", async ({ sessionId, seq, blob, filename }) => {
    try {
      // blob is expected to be ArrayBuffer transferred from client
      const sessionDir = path.join(TMP_ROOT, sessionId);
      ensureDirSync(sessionDir);
      const seqStr = String(seq).padStart(4, "0");
      const outName = filename || `chunk-${seqStr}.webm`;
      const filepath = path.join(sessionDir, outName);
      let buf;
      try {
        buf = toBuffer(blob);
      } catch (e) {
        console.error('failed to convert incoming audio blob to Buffer', e, { sessionId, seq });
        socket.emit('error', { message: 'audio-chunk conversion failed' });
        return;
      }
      await fs.promises.writeFile(filepath, buf);
      console.log(`wrote chunk ${outName} for session ${sessionId}`);

      // persist chunk metadata to lightweight DB (text will be filled by worker)
      await dbCreateChunk({
        id: `${sessionId}-${seq}`,
        sessionId: sessionId,
        filename: outName,
        index: seq,
        text: null,
        createdAt: new Date().toISOString(),
      });

      socket.emit("chunk-saved", { sessionId, seq, filename: outName });
    } catch (err) {
      console.error("audio-chunk error", err);
      socket.emit("error", { message: "audio-chunk failed" });
    }
  });

  socket.on("end-session", async ({ sessionId }) => {
    try {
      console.log("end-session", sessionId);
  // mark session as processing in lightweight DB
  await dbUpdateSessionStatus(sessionId, "PROCESSING");

      socket.emit("session-ended", { sessionId });

      // fire-and-forget transcription worker (mock for now)
      transcribeSession(sessionId)
        .then(() => {
          console.log("transcription complete for", sessionId);
          io.emit("transcription-complete", { sessionId });
        })
        .catch((err) => {
          console.error("transcription worker failed", err);
          io.emit("transcription-error", { sessionId, error: String(err) });
        });
    } catch (err) {
      console.error("end-session error", err);
      socket.emit("error", { message: "end-session failed" });
    }
  });
});

