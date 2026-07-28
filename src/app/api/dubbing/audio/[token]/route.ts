import { NextResponse } from 'next/server';
import { getDubbingJobByAudioToken } from '@/lib/dubbingStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: { token: string };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Public, short-lived audio endpoint for third-party ASR fetches.
 *
 * The token is a random per-job nonce stored only in the in-memory dubbing job
 * store. It is intentionally separate from /api/asr/audio because subtitle ASR
 * validates against persisted subtitle jobs.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const rawToken = params.token ?? '';
  const token = rawToken.replace(/\.(webm|mp3|wav|m4a|aac|ogg|opus|flac)$/i, '');
  if (!token || !/^[a-z0-9-]{16,64}$/i.test(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const job = getDubbingJobByAudioToken(token);
  if (!job || job.status === 'done' || job.status === 'failed') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const contentType = job.audioType || 'audio/webm';
  return new Response(new Blob([toArrayBuffer(job.audioBytes)], { type: contentType }), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(job.audioBytes.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
