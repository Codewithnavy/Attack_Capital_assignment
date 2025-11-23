"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Minimal recording dashboard for ScribeAI prototype.
 * - Choose source: microphone or tab (getDisplayMedia)
 * - Chunks audio using MediaRecorder and sends via Socket.io to the server
 * - Emits/receives simple status events for real-time UI updates
 *
 * This file is intentionally commented to be educational and easy to extend.
 */

type Chunk = {
  id: string;
  sessionId: string;
  filename: string;
  index: number;
  text: string | null;
  createdAt: string;
};

type Summary = {
  sessionId: string;
  text: string;
  createdAt: string;
};

type SessionRow = {
  session: { id: string; title: string; status: string; createdAt: string };
  chunks: Chunk[];
  summaries: Summary[];
};

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [source, setSource] = useState<"mic" | "tab">("mic");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunksSent, setChunksSent] = useState(0);
  const [seq, setSeq] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcribeResult, setTranscribeResult] = useState<Record<string, unknown> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Mint a short-lived dev token from the socket server, then connect using it.
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4001";
    let mounted = true;

    async function init() {
      try {
        const userId = `browser-${crypto.randomUUID().slice(0, 6)}`;
        const tokenRes = await fetch(`/api/dev/token?userId=${encodeURIComponent(userId)}`);
        const tokenJson = await tokenRes.json();
        const t = tokenJson?.token;
        if (mounted && t) setToken(t);

        const socket = io(socketUrl, { auth: { token: t } });
        const localToken = t;
        socket.on("connect", () => {
          console.log("connected to socket", socket.id);
          setErrorMsg(null);
        });
        socket.on("connect_error", (err) => {
          console.warn('socket connect_error', String(err));
          setErrorMsg(String(err));
        });
        socket.on("error", (payload) => {
          console.warn('socket error', payload);
          const payloadMsg = payload && typeof payload === 'object' && 'message' in (payload as Record<string, unknown>) ? String((payload as Record<string, unknown>)['message']) : String(payload);
          setErrorMsg(payloadMsg);
        });
        socket.on("status", (payload: { status: string }) => {
          setStatus(payload.status);
        });
        socket.on('transcription-complete', async () => {
          // refresh sessions when a transcription completes (use localToken captured at connect)
          try {
            const headers: Record<string,string> = { accept: 'application/json' };
            if (localToken) headers.authorization = `Bearer ${localToken}`;
            const res = await fetch('/api/sessions', { headers });
            const data = await res.json().catch(() => null);
            if (data && data.ok) setSessions(data.data);
          } catch (e) {
            console.warn('failed to refresh sessions after transcription-complete', e);
          }
        });
        socketRef.current = socket;
      } catch (err) {
        console.warn('failed to mint token or connect socket', err);
      }
    }

    init();

    return () => {
      mounted = false;
      socketRef.current?.disconnect();
    };
  }, []);

  // fetch session history
  const fetchSessions = useCallback(async () => {
    try {
      const headers: Record<string,string> = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch("/api/sessions", { headers });
      const data = await res.json();
      if (data.ok) setSessions(data.data);
    } catch (err) {
      console.warn("failed to fetch sessions", err);
    }
  }, [token]);

  const exportSession = async (sessionId: string, format: 'txt' | 'srt' | 'json') => {
    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`;
      const headers: Record<string,string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn('export failed', res.status);
        return;
      }
      const ct = res.headers.get('content-type') || '';
      if (format === 'json' || ct.includes('application/json')) {
        const json = await res.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `session-${sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
        return;
      }
      const text = await res.text();
      const blob = new Blob([text], { type: ct || 'text/plain' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `session-${sessionId}.${format === 'srt' ? 'srt' : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      console.error('exportSession error', err);
    }
  };

  const runTranscribeTest = async (sessionId?: string) => {
    try {
      setTranscribeResult(null);
      const sid = sessionId || sessionIdStateOrFirst();
      if (!sid) return setTranscribeResult({ ok: false, error: 'no sessionId available' });
      const res = await fetch('/api/dev/transcribe-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ sessionId: sid }),
      });
      const j = await res.json().catch(() => ({}));
      setTranscribeResult(j as Record<string, unknown>);
      // refresh sessions list after run
      setTimeout(() => fetchSessions(), 800);
      return j;
    } catch (err) {
      setTranscribeResult({ ok: false, error: String(err) });
      return { ok: false, error: String(err) };
    }
  };

  const sessionIdStateOrFirst = () => {
    if (sessionId) return sessionId;
    if (sessions && sessions.length > 0) return sessions[0].session.id;
    return null;
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const startRecording = async () => {
    try {
      setStatus("starting");
      const id = crypto.randomUUID();
      setSessionId(id);
      const constraints = source === "mic" ? { audio: true } : { audio: true, video: false };
      const stream =
        source === "mic"
          ? await navigator.mediaDevices.getUserMedia(constraints)
          : // getDisplayMedia typing is inconsistent in some TS setups; use a safe cast
            await (navigator.mediaDevices as unknown as { getDisplayMedia?: (opts?: MediaStreamConstraints) => Promise<MediaStream> }).getDisplayMedia?.({ audio: true, video: false });

      if (!stream) {
        throw new Error('Failed to acquire media stream');
      }

      // Choose a supported mimeType when possible to avoid NotSupportedError in some browsers
      let mimeType = '';
      try {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
          }
        }
      } catch {
        // ignore detection errors and fallback to default
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  mediaRecorderRef.current = recorder;
  socketRef.current?.emit("start-session", { sessionId: id, metadata: { source } });
      setStatus("recording");

      recorder.ondataavailable = (ev: BlobEvent) => {
        // Send chunk as ArrayBuffer to the socket server along with metadata
        ev.data.arrayBuffer().then((arrayBuffer) => {
          const seqNow = seq + 1;
          setSeq(seqNow);
          socketRef.current?.emit("audio-chunk", { sessionId: id, seq: seqNow, blob: arrayBuffer });
          setChunksSent((s) => s + 1);
        });
      };

      recorder.start(30000); // 30s chunks; adjust as needed for latency
    } catch (err) {
      console.error("failed to start recording", err);
      setStatus("error");
    }
  };

  const stopRecording = () => {
    setStatus("stopping");
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (sessionId) {
      socketRef.current?.emit("end-session", { sessionId });
      // refresh sessions after a short delay so the worker can write results
      setTimeout(() => fetchSessions(), 1200);
    }
    setStatus("processing");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1b0b2a] to-black p-8 text-white">
      <header className="max-w-5xl mx-auto">
        <div className="rounded-2xl bg-gradient-to-r from-[#2e0657] to-[#6b2aa8] p-6 shadow-lg">
          <h1 className="text-3xl font-extrabold">ScribeAI</h1>
          <p className="mt-1 text-sm text-white/80">Turn messy meetings into clear, actionable notes — live scribing prototype</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto mt-8 space-y-6">
        <section className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" checked={source === "mic"} onChange={() => setSource("mic")} /> Microphone
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={source === "tab"} onChange={() => setSource("tab")} /> Tab / Screen Audio
          </label>
        </section>

        <section className="flex items-center gap-4 bg-white/5 p-4 rounded-lg">
          <div className="flex gap-3">
            <button
              className="rounded-full bg-gradient-to-r from-[#7c2be6] to-[#c76cff] px-5 py-2 font-semibold shadow-md"
              onClick={startRecording}
              disabled={status === "recording" || status === "starting"}
            >
              Start
            </button>
            <button
              className="rounded-full bg-red-600/90 px-5 py-2 font-semibold shadow-md"
              onClick={stopRecording}
              disabled={status !== "recording" && status !== "starting"}
            >
              Stop
            </button>
          </div>

          <div className="ml-auto text-sm text-white/80">
            <div>Session: {sessionId ?? "—"}</div>
            <div>Status: {status}</div>
            <div>Chunks sent: {chunksSent}</div>
          </div>
        </section>
        <section className="pt-4 border-t border-white/5">
          <h2 className="text-lg font-medium">Notes</h2>
          <ul className="list-disc pl-5 text-sm text-white/80">
            <li>Chunks are sent every 30s (MediaRecorder timeslice). For lower latency, reduce this value.</li>
            <li>Tab audio uses getDisplayMedia to capture system/tab audio (browser support varies).</li>
            <li>On stop, server aggregates chunks and runs transcription/summarization (pipeline not yet implemented).</li>
          </ul>
        </section>

        <section className="pt-4 border-t border-white/5">
          <h2 className="text-lg font-medium">Developer</h2>
          <div className="mt-3 p-3 bg-white/3 rounded-md text-sm text-white/80">
            <div className="mb-2">Token: <code className="bg-black/50 px-2 py-0.5 rounded">{token ?? 'not fetched'}</code></div>
            <div className="flex gap-2 mb-2">
              <button
                className="px-2 py-1 bg-white/5 rounded text-xs"
                onClick={() => navigator.clipboard?.writeText(token ?? '')}
              >Copy Token</button>
              <button
                className="px-2 py-1 bg-white/5 rounded text-xs"
                onClick={() => runTranscribeTest(sessionIdStateOrFirst() ?? undefined)}
              >Run /api/dev/transcribe-test</button>
            </div>
            {errorMsg && <div className="text-xs text-red-300 mb-2">Socket error: {errorMsg}</div>}
            {transcribeResult && (
              <div className="text-xs bg-black/20 p-2 rounded mt-2">
                <pre className="whitespace-pre-wrap">{JSON.stringify(transcribeResult, null, 2)}</pre>
              </div>
            )}
          </div>
        </section>

        <section className="pt-6 border-t border-white/5">
          <h2 className="text-lg font-medium">Session History</h2>
          <div className="mt-3 space-y-3">
            {sessions.length === 0 ? (
              <div className="text-sm text-white/60">No sessions yet</div>
            ) : (
              sessions.map((row: SessionRow) => (
                <div key={row.session.id} className="p-3 bg-white/3 rounded-md">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-medium">{row.session.title}</div>
                      <div className="text-xs text-white/70">{row.session.id} — {new Date(row.session.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-sm text-white/80">{row.session.status}</div>
                  </div>
                  <div className="mt-2 text-sm text-white/80">
                    Chunks: {row.chunks.length} — Summaries: {row.summaries.length}
                    {row.summaries.length > 0 && (
                      <div className="mt-2 p-2 bg-white/5 rounded">{row.summaries[0].text}</div>
                    )}

                    <div className="mt-3 flex gap-2">
                      <a className="text-xs text-blue-300 underline" href={`/api/sessions/${encodeURIComponent(row.session.id)}`}>View</a>
                      <button className="text-xs px-2 py-1 bg-white/5 rounded" onClick={() => exportSession(row.session.id, 'txt')}>Export TXT</button>
                      <button className="text-xs px-2 py-1 bg-white/5 rounded" onClick={() => exportSession(row.session.id, 'srt')}>Export SRT</button>
                      <button className="text-xs px-2 py-1 bg-white/5 rounded" onClick={() => exportSession(row.session.id, 'json')}>Export JSON</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
