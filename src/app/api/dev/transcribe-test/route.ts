import { NextResponse } from 'next/server';
import { transcribeSession } from '../../../../../server/transcription-worker.js';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body.sessionId;
    if (!sessionId) return NextResponse.json({ ok: false, error: 'missing sessionId' }, { status: 400 });

    // This will run the transcription pipeline using whatever configuration
    // is present. It will not make external calls unless ENABLE_REAL_TRANSCRIPTION
    // is set and provider initialization succeeded. This keeps the test safe by
    // default in local dev.
    const result = await transcribeSession(sessionId);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('transcribe-test error', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
