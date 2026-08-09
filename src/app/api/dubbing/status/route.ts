import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getDubbingJob,
  saveLocalDubbingAsset,
  updateDubbingJob,
} from '@/lib/dubbingStore';
import { generateDubbingAssets } from '@/services/dubbingProviders';
import { buildPrivateMediaPath } from '@/lib/privateMedia';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  type MediaJobStage,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface DubbingStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  audioUrl?: string;
  cameraUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  error?: string;
}

function resultUrl(req: Request, jobId: string, asset: string): string {
  return new URL(`/api/dubbing/result/${jobId}/${asset}`, req.url).pathname;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });
  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });
  let job;
  try {
    job = await getDubbingJob(jobId, user.id);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('dubbing.status.read', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });
  if (job.status === 'done') {
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      audioUrl: resultUrl(req, jobId, 'audio.wav'),
      cameraUrl: job.lipSyncCameraPath ? resultUrl(req, jobId, 'camera.webm') : undefined,
      lipSync: job.lipSync ?? 'skipped',
      provider: job.provider,
    });
  }
  if (job.status === 'failed') return NextResponse.json({ status: 'failed', error: job.error ?? 'unknown' });
  // A previous function may have died after claiming the job. Recent claims
  // remain single-flight; stale claims are recoverable on the next poll.
  if (job.status === 'running' && Date.now() - job.updatedAt < 120_000) {
    return NextResponse.json({ status: 'running' });
  }

  let stage: MediaJobStage = 'database';
  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  const removeSources = async () => {
    const paths = [job.audioAssetPath, job.cameraAssetPath].filter((value): value is string => !!value);
    if (admin && paths.length > 0) await admin.storage.from('recordings').remove(paths).catch(() => undefined);
  };
  try {
    await updateDubbingJob(jobId, user.id, { status: 'running' });
    if (job.audioAssetPath || job.cameraAssetPath) admin = createSupabaseAdminClient();
    stage = 'storage';
    let sourceAudioFileUrl: string | undefined;
    if (job.audioAssetPath) {
      if (!admin) throw Object.assign(new Error('Supabase service role is not configured'), { code: 'SUPABASE_ADMIN_NOT_CONFIGURED' });
      const { data, error } = await admin.storage.from('recordings').createSignedUrl(job.audioAssetPath, 3600);
      if (error || !data?.signedUrl) throw new Error(`dubbing_audio_sign_failed: ${error?.message ?? 'missing_url'}`);
      sourceAudioFileUrl = data.signedUrl;
    }
    let cameraBytes: Uint8Array | undefined;
    // Camera is an optional second-stage input. Do not materialize it in the
    // normal audio/subtitle path; current lip-sync is only enabled explicitly.
    if (job.cameraAssetPath && process.env.DUBBING_MOCK_LIPSYNC === '1') {
      if (!admin) throw Object.assign(new Error('Supabase service role is not configured'), { code: 'SUPABASE_ADMIN_NOT_CONFIGURED' });
      const { data, error } = await admin.storage.from('recordings').download(job.cameraAssetPath);
      if (error || !data) throw new Error(`dubbing_camera_download_failed: ${error?.message ?? 'missing_blob'}`);
      cameraBytes = new Uint8Array(await data.arrayBuffer());
    }
    stage = 'external_service';
    const result = await generateDubbingAssets({
      sourceSrt: job.sourceSrt,
      sourceAudioFileUrl,
      cameraBytes,
    });

    let dubbedAudioPath: string;
    let lipSyncCameraPath: string | undefined;
    if (job.audioAssetPath) {
      if (!admin) throw Object.assign(new Error('Supabase service role is not configured'), { code: 'SUPABASE_ADMIN_NOT_CONFIGURED' });
      stage = 'storage';
      dubbedAudioPath = buildPrivateMediaPath(user.id, job.recordingId, 'dubbing', `${jobId}-audio.wav`);
      const audioUpload = await admin.storage.from('recordings').upload(
        dubbedAudioPath,
        new Blob([toArrayBuffer(result.audioBytes)], { type: result.audioType }),
        { contentType: result.audioType, upsert: true },
      );
      if (audioUpload.error) throw new Error(`dubbing_audio_store_failed: ${audioUpload.error.message}`);
      if (result.lipSyncCamera) {
        lipSyncCameraPath = buildPrivateMediaPath(user.id, job.recordingId, 'dubbing', `${jobId}-camera.webm`);
        const cameraUpload = await admin.storage.from('recordings').upload(
          lipSyncCameraPath,
          new Blob([toArrayBuffer(result.lipSyncCamera)], { type: result.lipSyncCameraType ?? 'video/webm' }),
          { contentType: result.lipSyncCameraType ?? 'video/webm', upsert: true },
        );
        if (cameraUpload.error) throw new Error(`dubbing_camera_store_failed: ${cameraUpload.error.message}`);
      }
    } else {
      dubbedAudioPath = await saveLocalDubbingAsset(jobId, 'audio.wav', result.audioBytes);
      if (result.lipSyncCamera) {
        lipSyncCameraPath = await saveLocalDubbingAsset(jobId, 'camera.webm', result.lipSyncCamera);
      }
    }
    stage = 'database';
    const done = await updateDubbingJob(jobId, user.id, {
      status: 'done',
      translatedSrt: result.translatedSrt,
      dubbedAudioPath,
      dubbedAudioType: result.audioType,
      lipSyncCameraPath,
      lipSyncCameraType: result.lipSyncCameraType,
      lipSync: result.lipSync,
      provider: result.provider,
    });
    await removeSources();
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      audioUrl: resultUrl(req, jobId, 'audio.wav'),
      cameraUrl: done?.lipSyncCameraPath ? resultUrl(req, jobId, 'camera.webm') : undefined,
      lipSync: done?.lipSync ?? 'skipped',
      provider: done?.provider,
    });
  } catch (error) {
    const failure = mediaJobFailurePayload(error, stage);
    reportMediaJobFailure('dubbing.status', failure);
    await updateDubbingJob(jobId, user.id, { status: 'failed', error: failure.cause }).catch(() => undefined);
    await removeSources();
    return NextResponse.json({
      status: 'failed',
      error: failure.cause,
      code: failure.code,
      stage: failure.stage,
      cause: failure.cause,
    });
  }
}
