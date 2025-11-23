import { NextResponse } from 'next/server';
import { createToken } from '../../../../../server/auth.js';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || `dev-${Math.random().toString(36).slice(2,8)}`;
    const ttl = url.searchParams.get('ttl') ? Number(url.searchParams.get('ttl')) : undefined;
    const token = createToken({ userId }, ttl);
    return NextResponse.json({ ok: true, token, userId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = body.userId || `dev-${Math.random().toString(36).slice(2,8)}`;
    const ttl = body.ttl ? Number(body.ttl) : undefined;
    const token = createToken({ userId }, ttl);
    return NextResponse.json({ ok: true, token, userId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
}
