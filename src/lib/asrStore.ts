/**
 * Server-side ephemeral audio store for ASR jobs.
 *
 * Audio is uploaded by the client (Pro user) → saved to /tmp →
 * exposed via /api/asr/audio/[token] → DashScope fetches it →
 * we delete the file after the job completes.
 *
 * /tmp survives the lifetime of a single Vercel function instance only,
 * which is fine because ASR jobs complete within minutes.
 *
 * NOT a persistent store. NEVER use for anything beyond ephemeral ASR.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const STORE_DIR = path.join(
  process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp' : path.join(process.cwd(), 'data'),
  'asr-audio',
);

function ensureDir(): void {
  if (!fsSync.existsSync(STORE_DIR)) fsSync.mkdirSync(STORE_DIR, { recursive: true });
}

export async function saveAudio(token: string, bytes: Uint8Array): Promise<void> {
  ensureDir();
  // Validate token shape (uuid-like) before using as filename — defence against path traversal.
  if (!/^[a-z0-9-]{16,64}$/i.test(token)) throw new Error('invalid token');
  const filePath = path.join(STORE_DIR, `${token}.webm`);
  await fs.writeFile(filePath, bytes);
}

export async function readAudio(token: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]{16,64}$/i.test(token)) return null;
  const filePath = path.join(STORE_DIR, `${token}.webm`);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function deleteAudio(token: string): Promise<void> {
  if (!/^[a-z0-9-]{16,64}$/i.test(token)) return;
  const filePath = path.join(STORE_DIR, `${token}.webm`);
  try {
    await fs.unlink(filePath);
  } catch {
    // already gone
  }
}
