import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/db';
import { createDubbingJob } from '@/lib/dubbingStore';
import { TIER_PERMISSIONS } from '@/types/user';
import { isOwnedPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isEntitled(status: string, tier: keyof typeof TIER_PERMISSIONS): boolean {
  return (status === 'active' || status === 'paused' || status === 'past_due')
    && TIER_PERMISSIONS[tier].dubbing;
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const sub = await getUserSubscription(user.id);
  const tier = sub?.tier ?? 'free';
  if (!isEntitled(sub?.status ?? 'inactive', tier)) {
    return NextResponse.json({ error: 'tier_required', message: 'Dubbing requires Max.' }, { status: 403 });
  }
  try {
    const body = await req.json() as Record<string, unknown>;
    const localMock = body.localMock === true
      && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(req.url).hostname);
    const parsed = localMock ? {
      recordingId: String(body.recordingId ?? ''),
      assetPath: '',
      bytes: 1,
      mimeType: 'audio/webm',
      cameraAssetPath: undefined,
    } : parseMediaSubmitPayload(body);
    if (!parsed.recordingId) throw new Error('missing_recording_id');
    if (body.targetLang !== 'en') throw new Error('unsupported_target_language');
    if (typeof body.sourceAudioHash !== 'string' || !body.sourceAudioHash) throw new Error('missing_source_audio_hash');
    if (!localMock && !isOwnedPrivateMediaPath(user.id, parsed.assetPath)) throw new Error('forbidden_asset_path');
    if (parsed.cameraAssetPath && !isOwnedPrivateMediaPath(user.id, parsed.cameraAssetPath)) throw new Error('forbidden_camera_asset_path');
    const now = Date.now();
    const jobId = randomUUID();
    await createDubbingJob({
      id: jobId, userId: user.id, recordingId: parsed.recordingId, targetLang: 'en',
      sourceAudioHash: body.sourceAudioHash, sourceSrt: typeof body.sourceSrt === 'string' ? body.sourceSrt : undefined,
      status: 'pending', createdAt: now, updatedAt: now,
      audioAssetPath: parsed.assetPath || undefined,
      cameraAssetPath: parsed.cameraAssetPath,
    });
    return NextResponse.json({ jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_request';
    return NextResponse.json({ error: message, message }, { status: 400 });
  }
}
