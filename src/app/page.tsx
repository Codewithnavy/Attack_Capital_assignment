"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Minimal recording dashboard for ScribeAI prototype.
 * - Choose source: microphone or tab (getDisplayMedia)
 * - Chunks audio using MediaRecorder and sends via Socket.io to the server
 * - Emits/receives simple status events for real-time UI updates
 *
 * This file is intentionally commented to be educational and easy to extend.
 */

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [source, setSource] = useState<"mic" | "tab">("mic");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunksSent, setChunksSent] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // connect to socket server when component mounts
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000");
    socket.on("connect", () => {
      console.log("connected to socket", socket.id);
    });
    socket.on("status", (payload: { status: string }) => {
      setStatus(payload.status);
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, []);

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
        // Send chunk as ArrayBuffer to the socket server
        ev.data.arrayBuffer().then((arrayBuffer) => {
          // socket.io client supports ArrayBuffer/binary directly
          socketRef.current?.emit("audio-chunk", arrayBuffer);
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
      </main>
    </div>
  );
}
