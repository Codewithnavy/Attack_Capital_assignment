import { NextResponse } from "next/server";

// Proxy to the local socket server's /sessions endpoint. The socket server
// runs as a Node process and imports the Prisma client directly. This keeps
// Prisma out of the Next app route bundle and avoids Turbopack/Edge issues.
export async function GET() {
  try {
    const res = await fetch("http://localhost:4000/sessions");
    if (!res.ok) {
      const text = await res.text();
      console.error('/api/sessions proxy error', res.status, text);
      return NextResponse.json({ ok: false, error: text }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("/api/sessions proxy failed", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
