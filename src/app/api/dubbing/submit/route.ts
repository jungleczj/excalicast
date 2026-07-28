import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/db';
import { createDubbingJob } from '@/lib/dubbingStore';
import { TIER_PERMISSIONS } from '@/types/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_CAMERA_BYTES = 200 * 1024 * 1024;

function isEntitled(status: string, tier: keyof typeof TIER_PERMISSIONS): boolean {
  return (status === 'active' || status === 'paused' || status === 'past_due')
    && TIER_PERMISSIONS[tier].dubbing;
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sub = await getUserSubscription(userId);
  const tier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'inactive';
  if (!isEntitled(status, tier)) {
    return NextResponse.json(
      { error: 'tier_required', message: 'Dubbing requires Max.' },
      { status: 403 },
    );
  }

  try {
    const form = await req.formData();
    const recordingId = form.get('recordingId');
    const targetLang = form.get('targetLang');
    const sourceAudioHash = form.get('sourceAudioHash');
    const sourceSrt = form.get('sourceSrt');
    const audio = form.get('audio');
    const camera = form.get('camera');

    if (typeof recordingId !== 'string' || !recordingId) {
      return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
    }
    if (targetLang !== 'en') {
      return NextResponse.json({ error: 'unsupported_target_language' }, { status: 400 });
    }
    if (typeof sourceAudioHash !== 'string' || !sourceAudioHash) {
      return NextResponse.json({ error: 'missing_source_audio_hash' }, { status: 400 });
    }
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: 'missing_audio' }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
    }
    if (camera != null && !(camera instanceof Blob)) {
      return NextResponse.json({ error: 'invalid_camera' }, { status: 400 });
    }
    if (camera instanceof Blob && camera.size > MAX_CAMERA_BYTES) {
      return NextResponse.json({ error: 'camera_too_large' }, { status: 413 });
    }

    const now = Date.now();
    const jobId = randomUUID();
    const audioToken = randomUUID().replace(/-/g, '');
    createDubbingJob({
      id: jobId,
      userId,
      recordingId,
      targetLang,
      sourceAudioHash,
      audioToken,
      audioType: audio.type || 'audio/webm',
      sourceSrt: typeof sourceSrt === 'string' ? sourceSrt : undefined,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      audioBytes: new Uint8Array(await audio.arrayBuffer()),
      cameraBytes: camera instanceof Blob ? new Uint8Array(await camera.arrayBuffer()) : undefined,
    });

    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_request', message: err instanceof Error ? err.message : 'parse_failed' },
      { status: 400 },
    );
  }
}
