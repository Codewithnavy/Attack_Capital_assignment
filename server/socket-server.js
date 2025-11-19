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

import http from 'http';
import fs from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.SOCKET_PORT || 4000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Socket server running');
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  socket.on('start-session', ({ sessionId }) => {
    const base = path.join(__dirname, '..', 'tmp', 'sessions', sessionId);
    fs.mkdirSync(base, { recursive: true });
    socket.join(sessionId);
    socket.data.sessionId = sessionId;
    socket.data.chunkIndex = 0;
    console.log(`session ${sessionId} started`);
    io.to(sessionId).emit('status', { status: 'recording' });
  });

  // Receive binary ArrayBuffer or Buffer from clients
  socket.on('audio-chunk', (payload) => {
    const sessionId = socket.data.sessionId || 'unknown';
    const idx = socket.data.chunkIndex || 0;
    const base = path.join(__dirname, '..', 'tmp', 'sessions', sessionId);
    try {
      // payload may be ArrayBuffer or Buffer; normalize to Buffer
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const filename = path.join(base, `chunk-${String(idx).padStart(4, '0')}.webm`);
      fs.writeFileSync(filename, buf);
      socket.data.chunkIndex = idx + 1;
      socket.emit('chunk-received', { index: idx });
    } catch (err) {
      console.error('failed to write chunk', err);
      socket.emit('error', { message: 'failed to store chunk' });
    }
  });

  socket.on('end-session', ({ sessionId }) => {
    console.log(`session ${sessionId} ended`);
    io.to(sessionId).emit('status', { status: 'processing' });
    // Placeholder: in production, trigger aggregation/transcription pipeline here
    setTimeout(() => {
      io.to(sessionId).emit('status', { status: 'completed', downloadUrl: `/tmp/sessions/${sessionId}` });
    }, 1000);
  });

  socket.on('disconnect', (reason) => {
    console.log('client disconnected', socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Socket server listening on port ${PORT}`);
});
