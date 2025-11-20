"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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

type Session = { id: string; title: string; status: string; createdAt: string };

export default function SessionPage() {
  const params = useParams();
  const id = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ session?: Session; chunks: Chunk[]; summaries: Summary[] }>({ chunks: [], summaries: [] });

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/sessions/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.data) {
          setData({ session: j.data.session, chunks: j.data.chunks || [], summaries: j.data.summaries || [] });
        }
      })
      .catch((err) => console.error('failed to load session', err))
      .finally(() => setLoading(false));
  }, [id]);

  const exportSession = async (format: 'txt'|'srt'|'json') => {
    try {
      const url = `/api/sessions/${encodeURIComponent(id)}/export?format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('export failed');
      const ct = res.headers.get('content-type') || '';
      if (format === 'json' || ct.includes('application/json')) {
        const json = await res.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `session-${id}.json`;
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
      a.download = `session-${id}.${format === 'srt' ? 'srt' : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      console.error('export error', err);
      alert('Export failed');
    }
  };

  if (!id) return <div className="p-6">No session id provided</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto text-white">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Session {id}</h1>
        {loading ? <div className="text-sm text-white/60">Loading…</div> : null}
        {data.session && (
          <div className="text-sm text-white/70">{data.session.title} — {new Date(data.session.createdAt).toLocaleString()}</div>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <button className="px-3 py-1 bg-white/5 rounded" onClick={() => exportSession('txt')}>Export TXT</button>
        <button className="px-3 py-1 bg-white/5 rounded" onClick={() => exportSession('srt')}>Export SRT</button>
        <button className="px-3 py-1 bg-white/5 rounded" onClick={() => exportSession('json')}>Export JSON</button>
      </div>

      <section className="mb-6">
        <h2 className="font-medium">Summaries</h2>
        {data.summaries.length === 0 ? <div className="text-sm text-white/60">No summaries yet</div> : (
          <div className="space-y-3 mt-2">
            {data.summaries.map((s) => (
              <div key={s.createdAt} className="p-3 bg-white/3 rounded">
                <div className="text-xs text-white/70">{new Date(s.createdAt).toLocaleString()}</div>
                <div className="mt-1">{s.text}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium">Chunks / Transcripts</h2>
        {data.chunks.length === 0 ? <div className="text-sm text-white/60 mt-2">No chunks</div> : (
          <div className="space-y-3 mt-2">
            {data.chunks.map((c) => (
              <div key={c.id} className="p-3 bg-white/3 rounded">
                <div className="text-xs text-white/70">{c.filename} — {new Date(c.createdAt).toLocaleString()}</div>
                <div className="mt-1 whitespace-pre-line">{c.text ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
