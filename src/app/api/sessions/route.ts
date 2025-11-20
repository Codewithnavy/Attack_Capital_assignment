import { NextResponse } from "next/server";

// Generic proxy to the local socket server. This keeps Prisma out of the
// Next app route bundle by forwarding requests to the Node socket server.
export async function GET(request: Request) {
  try {
    const port = process.env.SOCKET_PORT || "4001";
    const incoming = new URL(request.url);
    // incoming.pathname is like /api/sessions or /api/sessions/<rest>
    const suffix = incoming.pathname.replace(/^\/api/, "") || "/sessions";
    const target = `http://localhost:${port}${suffix}${incoming.search}`;

    const res = await fetch(target, { headers: { accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text();
      console.error('/api/sessions proxy error', res.status, text);
      return NextResponse.json({ ok: false, error: text }, { status: res.status });
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    // For non-JSON (exports), stream the body through
    const buffer = await res.arrayBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: res.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (err) {
    console.error('/api/sessions proxy failed', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
