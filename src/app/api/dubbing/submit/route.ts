import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/db';
import { createDubbingJob, getDubbingJob } from '@/lib/dubbingStore';
import { TIER_PERMISSIONS } from '@/types/user';
import { isOwnedPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { verifyPrivateMediaAsset } from '@/lib/privateMediaStorage';
import {
  executeMediaJobSubmission,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';
import type { AzureEnglishVoice, VoiceRegister } from '@/services/voiceProfile';

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
  let sub;
  try {
    sub = await getUserSubscription(user.id);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('dubbing.submit.entitlement', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
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
    const sourceSrt = typeof body.sourceSrt === 'string' ? body.sourceSrt.trim() : '';
    if (!parsed.recordingId) throw new Error('missing_recording_id');
    if (!sourceSrt) throw new Error('dubbing_subtitles_required');
    if (body.targetLang !== 'en') throw new Error('unsupported_target_language');
    if (typeof body.sourceAudioHash !== 'string' || !body.sourceAudioHash) throw new Error('missing_source_audio_hash');
    const sourceAudioHash = body.sourceAudioHash;
    const allowedVoices = new Set<AzureEnglishVoice>([
      'en-US-AndrewMultilingualNeural',
      'en-US-AvaMultilingualNeural',
    ]);
    const voiceName = String(body.voiceName ?? '') as AzureEnglishVoice;
    if (!allowedVoices.has(voiceName)) throw new Error('unsupported_dubbing_voice');
    const voiceRegister = String(body.voiceRegister ?? 'uncertain') as VoiceRegister;
    if (!['masculine', 'feminine', 'uncertain'].includes(voiceRegister)) throw new Error('invalid_voice_register');
    const voiceConfidence = Math.max(0, Math.min(1, Number(body.voiceConfidence) || 0));
    if (!localMock && !isOwnedPrivateMediaPath(user.id, parsed.assetPath, parsed.recordingId, 'dubbing')) throw new Error('forbidden_asset_path');
    if (parsed.cameraAssetPath && !isOwnedPrivateMediaPath(user.id, parsed.cameraAssetPath, parsed.recordingId, 'dubbing')) throw new Error('forbidden_camera_asset_path');
    const now = Date.now();
    const jobId = randomUUID();
    let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
    try {
      const result = await executeMediaJobSubmission({
        verifyStorage: async () => {
          if (localMock) return;
          admin = createSupabaseAdminClient();
          await verifyPrivateMediaAsset(admin, parsed.assetPath, parsed.bytes);
          if (parsed.cameraAssetPath && parsed.cameraBytes) {
            await verifyPrivateMediaAsset(admin, parsed.cameraAssetPath, parsed.cameraBytes);
          }
        },
        createJob: async () => {
          await createDubbingJob({
            id: jobId, userId: user.id, recordingId: parsed.recordingId, targetLang: 'en',
            sourceAudioHash, sourceSrt,
            voiceName, voiceRegister, voiceConfidence,
            status: 'pending', createdAt: now, updatedAt: now,
            audioAssetPath: parsed.assetPath || undefined,
            audioType: parsed.mimeType,
            cameraAssetPath: parsed.cameraAssetPath,
            cameraType: parsed.cameraMimeType,
          });
          return { jobId };
        },
        confirmJobCreated: async () => !!(await getDubbingJob(jobId, user.id)),
        cleanupAssets: async () => {
          const paths = [parsed.assetPath, parsed.cameraAssetPath].filter((path): path is string => !!path);
          if (admin && paths.length > 0) await admin.storage.from('recordings').remove(paths);
        },
      });
      return NextResponse.json(result);
    } catch (error) {
      const failure = mediaJobFailurePayload(error, 'database');
      reportMediaJobFailure('dubbing.submit', failure);
      return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_request';
    return NextResponse.json({ error: message, message }, { status: 400 });
  }
}
