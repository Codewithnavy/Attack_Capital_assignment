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

// Prisma client - generated client lives in src/generated/prisma
import { PrismaClient } from "../src/generated/prisma/index.js";
const prisma = new PrismaClient();

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

httpServer.listen(4000, () => {
  console.log("Socket server listening on port 4000");
});

// Basic HTTP API for sessions so the Next app can fetch session data
// without importing the Prisma client (avoids bundler issues).
httpServer.on('request', async (req, res) => {
  try {
    if (req.url === '/sessions' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const sessions = await prisma.session.findMany({ orderBy: { createdAt: 'desc' } });
      const results = await Promise.all(
        sessions.map(async (s) => {
          const chunks = await prisma.transcriptChunk.findMany({ where: { sessionId: s.id }, orderBy: { index: 'asc' } });
          const summaries = await prisma.summary.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' } });
          return { session: s, chunks, summaries };
        })
      );
      res.end(JSON.stringify({ ok: true, data: results }));
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

      // create a session row in the database (anonymous for now)
      await prisma.session.create({
        data: {
          id: sessionId,
          title: `Session ${sessionId}`,
          status: "RECORDING",
        },
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
      const buf = Buffer.from(blob);
      await fs.promises.writeFile(filepath, buf);
      console.log(`wrote chunk ${outName} for session ${sessionId}`);

      // persist chunk metadata to DB (text will be filled by worker)
      await prisma.transcriptChunk.create({
        data: {
          sessionId: sessionId,
          filename: outName,
          index: seq,
          text: null,
        },
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
      // mark session as processing
      await prisma.session.update({ where: { id: sessionId }, data: { status: "PROCESSING" } });

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

