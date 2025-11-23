# Live-scribe Prototype (Attack Capital Assignment)

This repository is a prototype live-scribing app: client records audio, streams chunks to a Node socket server which stores chunk files and runs a (mock) transcription worker. The Next.js app proxies API calls to the socket server to avoid bundling server-only libraries into the frontend.

Quick start (development)

1. Install dependencies

```powershell
npm install
```

2. Run both servers (recommended)

```powershell
# Starts socket server (port 4001) and Next dev (port 3000) together
npm run dev:all
```

3. Run servers separately

Socket server (foreground):

```powershell
npm run start:socket
# or: cross-env SOCKET_PORT=4001 node server/socket-server.js
```

Next dev (foreground):

```powershell
npm run dev
# or: cross-env NEXT_DISABLE_ESLINT=1 next dev -p 3000
```

API endpoints

- Socket server (direct): `http://localhost:4001/sessions` — list sessions
- Socket server export: `http://localhost:4001/sessions/:id/export?format=txt|srt|json`
- Next proxy: `http://localhost:3000/api/sessions` — forwards to socket server

Notes

- The project ships a lightweight JSON-backed dev-store at `tmp/db.json`. This is a development shim used to avoid requiring a Postgres instance / Prisma runtime while iterating locally. For production, swap the server to use `@prisma/client` and a proper Postgres DB.
- `src/generated/prisma` contains generated Prisma artifacts that can cause ESLint and bundler noise. The dev workflow avoids importing these files into the Next app routes. Consider moving generated client out of `src/` or excluding it from the app build in CI.

Optional: real transcription

The transcription worker currently uses a mock implementation by default. To enable a real transcription/generative client, set the environment flag and provide an API key (supported env vars):

```powershell
# enable real transcription (opt-in)
setx ENABLE_REAL_TRANSCRIPTION 1
setx GOOGLE_API_KEY "<your-key>"
```

The worker will attempt to lazy-load `@google/generative-ai` and use the provided key; if not configured properly it will fall back to the mock worker.

Troubleshooting

- If you get `EADDRINUSE` errors, ensure no other process is listening on ports `3000` / `4001` and stop any leftover `node` processes.
- If Next dev shows large ESLint output from generated files, the dev script sets `NEXT_DISABLE_ESLINT=1` to avoid aborting development builds; fix generated code or move it out of `src/` to permanently silence it.

What's next

- Clean up or relocate generated Prisma client to remove lint/bundle issues.
- Replace mock transcription with a configured real transcription provider (requires keys).
- Add authentication and session ownership controls.

If you'd like, I can:
- Add a `dev:both` script that runs both servers in the foreground with combined logs.
- Move `src/generated/prisma` to a non-app folder to reduce tooling noise.
- Wire a specific transcription provider (Google or OpenAI) once you provide credentials.
# ScribeAI — AI-powered Live Scribing Prototype

This repository contains a Next.js 14 (App Router) prototype for ScribeAI — a real-time meeting scribing app that captures microphone or tab/screen audio, streams chunked audio to a Node Socket.io server for downstream transcription, and stores session data in Postgres via Prisma.

The goal of this repository is an end-to-end prototype demonstrating a resilient chunked streaming pipeline, low-latency UI updates, and post-processing for summaries.

## Quick start (developer)

Prerequisites:
- Node.js 18+ or compatible
- Docker (optional, for Postgres)
- npm (or yarn/pnpm)

1. Copy environment variables into a local `.env` file (example `.env.example` not included here). Important variables:

```
DATABASE_URL=postgres://postgres:Navneet%4099840@localhost:5432/scribeai
GEMINI_API_KEY=your_gemini_key_here
SUPABASE_API_KEY=your_supabase_key_here
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

2. (Optional) Start a local Postgres for development:

```powershell
docker compose up -d
# Wait until Postgres is ready, then run migrations below
```

3. Generate Prisma client & run migrations:

```powershell
npx prisma generate
npx prisma migrate dev --name init
```

4. Start the Socket.io server and Next dev server in separate terminals:

```powershell
npm run start:socket
npm run dev
```

Open http://localhost:3000 and allow microphone or tab capture to test recording.

## What is included (current status)
- Next.js frontend with a client-side recording dashboard (`src/app/page.tsx`) that captures mic or tab audio, chunks via MediaRecorder, and streams chunks to Socket.io.
- Node Socket.io server (`server/socket-server.js`) that accepts binary chunks and stores them under `tmp/sessions/<sessionId>/`.
- Prisma schema (`prisma/schema.prisma`) and generated client (`src/generated/prisma`) with models: User, Session, TranscriptChunk, Summary.
- ESLint/Next config updated to ignore generated runtime files and to set Turbopack root.

## Architecture (streaming pipeline)

The prototype uses a chunked streaming pipeline: the client records audio and emits 30s chunks (configurable) to a Socket.io server. The server writes chunks to disk and emits status updates back to clients. A worker (not yet implemented) will read chunks, forward audio to Gemini for transcription, and save transcripts to Postgres.

### Mermaid flow

```mermaid
flowchart LR
  Client((Browser)) -->|getUserMedia / getDisplayMedia| MediaRecorder
  MediaRecorder -->|chunked WebM blobs| SocketIOClient
  SocketIOClient -->|binary chunk| SocketServer[Socket.io Server]
  SocketServer -->|store chunk files| Filesystem[(tmp/sessions/<id>)]
  Filesystem -->|aggregate / stream| TranscriptionWorker[Transcription Worker]
  TranscriptionWorker -->|calls Gemini API| Gemini[Google Gemini]
  Gemini -->|transcript & diarization| TranscriptionWorker
  TranscriptionWorker -->|save| Postgres[(Postgres via Prisma)]
  SocketServer -->|status events| Client
  Client -->|update UI| UI[Next.js]
```

## Architecture comparison (streaming vs upload)

| Approach | Latency | Reliability | Complexity | Memory/CPU | Best for |
|---|---:|---:|---:|---:|---|
| WebRTC (real-time) | Lowest | Medium (network-sensitive) | High (signaling, NAT, SFU) | Low (server pass-through or SFU) | Multi-party low-latency transcription
| MediaRecorder + Socket.io (chunked streaming) | Low (seconds) | High (retransmit on chunk failure) | Medium | Moderate (store chunks on disk) | 1:1 or small groups, long sessions
| Upload after recording (batch) | High (minutes) | Very high | Low | High memory if not chunked | Offline transcription, highest accuracy after full file

Notes: WebRTC reduces latency but requires more infrastructure (SFU, TURN). Chunked streaming trades slightly higher latency for simpler server logic and resilience for long sessions.

## Long-session scalability (200‑word analysis)

Supporting 1+ hour meetings requires balancing client-side buffering, server-side disk usage, and transcription throughput. The prototype's chunked approach mitigates memory pressure by writing fixed-size chunks to disk as they arrive, keeping per-process memory small. On the server, a worker pool should process chunks in parallel while respecting Gemini rate limits; for large concurrency, scale workers horizontally and use a message queue (Redis/RabbitMQ) to decouple ingestion from transcription. Implement backpressure by acknowledging chunk receipts; if the server cannot keep up, instruct the client to extend timeslices or pause. For multi-tenant deployments, use per-tenant storage quotas and an object store (S3) for completed session artifacts to avoid disk exhaustion. Finally, implement resumable uploads and retry logic for network drops to ensure long recordings survive transient failures.

## How transcription will be wired (next steps)
1. Implement `lib/gemini.ts` with helper methods for streaming/HTTP calls to Gemini.
2. Add a `TranscriptionWorker` that reads chunk files and streams them to Gemini for incremental transcripts and diarization.
3. Save transcript chunks and a session summary to Postgres via Prisma models.

Recommended flow for this repo: start with chunked batch transcription (simpler), then iterate to streaming for lower latency once the worker and rate-limit handling are hardened.

## Troubleshooting
- If you see MediaRecorder NotSupportedError: the page includes runtime mime-type detection; ensure your browser supports `audio/webm;codecs=opus` (Chrome/Edge). On Safari, MediaRecorder support is limited; test in Chrome.
- If Socket.io fails to connect, check `NEXT_PUBLIC_SOCKET_URL` and ensure `npm run start:socket` is running.
- Prisma issues: ensure `DATABASE_URL` is correct and run `npx prisma migrate dev` after Postgres is available.

## Security
- Do not commit `.env` or secrets. Use environment variables or a secrets manager in CI/CD.

## Contributing / Commits
I recommend making small, focused commits per feature (prisma schema, socket server, frontend UI, gemini integration, worker). I can continue and implement transcription, auth, migrations and session pages on request.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

---

Note: small incremental commits are intentionally frequent in this branch to demonstrate active development and progress. (Edited at 2025-11-19)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
