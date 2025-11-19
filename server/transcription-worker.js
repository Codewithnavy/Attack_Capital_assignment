import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const TMP_ROOT = path.resolve(process.cwd(), "tmp", "sessions");

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
      await prisma.transcriptChunk.updateMany({
        where: { sessionId: sessionId, filename: filename },
        data: { text },
      });

      transcripts.push(text);
    }

    const aggregate = transcripts.join("\n\n");
    const summaryText = `Summary (mock): ${transcripts.length} chunks processed.`;

    // create a summary row
    await prisma.summary.create({
      data: {
        sessionId: sessionId,
        text: summaryText,
      },
    });

    // mark session completed and attach simple transcript in the session record
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", transcript: aggregate },
    });

    return { success: true };
  } catch (err) {
    console.error("transcribeSession failed", err);
    // mark session errored
    try {
      await prisma.session.update({ where: { id: sessionId }, data: { status: "ERROR" } });
    } catch (_) {}
    throw err;
  }
}
