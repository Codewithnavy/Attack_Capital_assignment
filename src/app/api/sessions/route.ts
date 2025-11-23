import { NextResponse } from "next/server";

// Generic proxy to the local socket server. This keeps Prisma out of the
// Next app route bundle by forwarding requests to the Node socket server.
export async function GET(request: Request) {
  try {
    const port = process.env.SOCKET_PORT || "4001";
    const incoming = new URL(request.url);
    // incoming.pathname is like /api/sessions or /api/sessions/<rest>
    const suffix = incoming.pathname.replace(/^\/api/, "") || "/sessions";

    // Try multiple hostnames in case DNS or hosts resolves differently on Windows.
    const hosts = ["localhost", "127.0.0.1"];
    let res: Response | null = null;
    let lastError: unknown = null;
    const auth = request.headers.get('authorization') || request.headers.get('Authorization') || undefined;
    for (const host of hosts) {
      const target = `http://${host}:${port}${suffix}${incoming.search}`;
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        if (auth) headers.authorization = auth;
        res = await fetch(target, { headers });
        break;
      } catch (e) {
        // capture and try next
        lastError = e;
        console.warn(`/api/sessions proxy: failed to fetch ${target}`, String(e));
      }
    }
    if (!res) {
      console.error('/api/sessions proxy failed (all hosts)', lastError);
      return NextResponse.json({ ok: false, error: 'socket server unreachable on port ' + port }, { status: 502 });
    }
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
