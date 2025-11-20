import fs from "fs/promises";
import path from "path";

const TMP_ROOT = path.resolve(process.cwd(), "tmp", "sessions");
const DB_FILE = path.resolve(process.cwd(), "tmp", "db.json");

async function readDb() {
  try {
    const txt = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    return { sessions: [], chunks: [], summaries: [] };
  }
}

async function writeDb(obj) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(obj, null, 2), "utf8");
}

async function updateChunkText(sessionId, filename, text) {
  const db = await readDb();
  for (let c of db.chunks) {
    if (c.sessionId === sessionId && c.filename === filename) {
      c.text = text;
    }
  }
  await writeDb(db);
}

async function createSummary(summary) {
  const db = await readDb();
  db.summaries.unshift(summary);
  await writeDb(db);
}

async function updateSession(sessionId, patch) {
  const db = await readDb();
  const idx = db.sessions.findIndex((s) => s.id === sessionId);
  if (idx !== -1) {
    db.sessions[idx] = { ...db.sessions[idx], ...patch };
    await writeDb(db);
  }
}

/**
 * Mock transcription worker.
 * - Reads chunk files from tmp/sessions/<sessionId>
 * - For each chunk creates a dummy transcript text and updates TranscriptChunk.text
 * - Creates a Summary row with an aggregate placeholder summary
 *
 * This is a stand-in for the real Gemini integration. Replace the internals
 * with actual calls to the Gemini API or a real STT pipeline later.
 */
export async function transcribeSession(sessionId) {
  const sessionDir = path.join(TMP_ROOT, sessionId);
  try {
    const entries = await fs.readdir(sessionDir);
    const chunkFiles = entries.filter((f) => f.toLowerCase().endsWith(".webm")).sort();

    // Simple per-chunk mock transcription
    const transcripts = [];
    for (let i = 0; i < chunkFiles.length; i++) {
      const filename = chunkFiles[i];
      // read file size to include in mock text
      let stats;
      try {
        stats = await fs.stat(path.join(sessionDir, filename));
      } catch (e) {
        stats = { size: 0 };
      }
      const text = `Transcribed (mock) for ${filename} — size ${stats.size} bytes`;

      // update TranscriptChunk entry by filename
      await updateChunkText(sessionId, filename, text);

      transcripts.push(text);
    }

    const aggregate = transcripts.join("\n\n");
    const summaryText = `Summary (mock): ${transcripts.length} chunks processed.`;

    // create a summary row
    await createSummary({ sessionId: sessionId, text: summaryText, createdAt: new Date().toISOString() });

    // mark session completed and attach simple transcript in the session record
    await updateSession(sessionId, { status: "COMPLETED", transcript: aggregate });

    return { success: true };
  } catch (err) {
    console.error("transcribeSession failed", err);
    // mark session errored
    try {
      await updateSession(sessionId, { status: "ERROR" });
    } catch (e) {
      console.error('failed to mark session ERROR in JSON DB', e);
    }
    throw err;
  }
}
