import { NextResponse } from 'next/server';
import { readAudio } from '@/lib/asrStore';
import { getSubtitleJobByAudioToken } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: { token: string };
}

/**
 * Public endpoint that DashScope fetches to retrieve the audio for an ASR job.
 *
 * Security: token is a 32-hex random per-job nonce stored in subtitle_jobs.audio_token.
 * Once the job reaches `done` or `failed`, the audio file is deleted (see /api/asr/status),
 * so the URL becomes 404. No user data is leaked beyond the audio bytes themselves.
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { token } = params;
  if (!token || !/^[a-z0-9-]{16,64}$/i.test(token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  // Reject tokens not matching any active job (defence-in-depth)
  const job = await getSubtitleJobByAudioToken(token);
  if (!job || job.status === 'done' || job.status === 'failed') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const data = await readAudio(token);
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Copy Buffer into a fresh ArrayBuffer to satisfy strict ArrayBuffer<->SharedArrayBuffer typing
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const blob = new Blob([ab], { type: 'audio/webm' });
  return new Response(blob, {
    headers: {
      'Content-Type': 'audio/webm',
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
