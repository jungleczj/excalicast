import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getDubbingJob,
  saveLocalDubbingAsset,
  updateDubbingJob,
} from '@/lib/dubbingStore';
import { generateDubbingTranslation } from '@/services/dubbingProviders';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  type MediaJobStage,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';
import { synthesizeAzureDubbing } from '@/services/azureSpeechProvider';
import { synthesizeEdgeTtsDubbing } from '@/services/edgeTtsProvider';
import type { AzureEnglishVoice } from '@/services/voiceProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface DubbingStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  audioUrl?: string;
  voiceName?: string;
  billableCharacters?: number;
  synthesisChunkCount?: number;
  error?: string;
}

function resultUrl(req: Request, jobId: string, asset: string): string {
  return new URL(`/api/dubbing/result/${jobId}/${asset}`, req.url).pathname;
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
      audioUrl: job.dubbedAudioPath ? resultUrl(req, jobId, 'audio.wav') : undefined,
      lipSync: job.lipSync ?? 'skipped',
      provider: job.provider,
      voiceName: job.voiceName,
      billableCharacters: job.billableCharacters,
      synthesisChunkCount: job.synthesisChunkCount,
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
    stage = 'external_service';
    const result = await generateDubbingTranslation(job.sourceSrt ?? '');
    let dubbedAudioPath: string | undefined;
    let dubbedAudioType: string | undefined;
    let provider = `${result.provider}+kokoro-local`;
    let billableCharacters: number | undefined;
    let synthesisChunkCount: number | undefined;

    const persistAudio = async (audioBytes: Uint8Array) => {
      dubbedAudioType = 'audio/wav';
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        admin ??= createSupabaseAdminClient();
        dubbedAudioPath = `${user.id}/${job.recordingId}/jobs/dubbing/${jobId}-audio.wav`;
        const audioBuffer = new ArrayBuffer(audioBytes.byteLength);
        new Uint8Array(audioBuffer).set(audioBytes);
        const { error: uploadError } = await admin.storage.from('recordings').upload(
          dubbedAudioPath,
          new Blob([audioBuffer], { type: dubbedAudioType }),
          { contentType: dubbedAudioType, cacheControl: '0', upsert: true },
        );
        if (uploadError) throw uploadError;
      } else {
        dubbedAudioPath = await saveLocalDubbingAsset(jobId, 'audio.wav', audioBytes);
      }
    };

    // 主用 edge-tts（免费、无需 key）；失败时回退 Azure Speech（如已配置）；
    // 两者都不可用则保持 provider=kokoro-local，由客户端本地合成兜底。
    if (job.voiceName) {
      try {
        const synthesized = await synthesizeEdgeTtsDubbing({
          translatedSrt: result.translatedSrt,
          voice: job.voiceName as AzureEnglishVoice,
        });
        provider = `${result.provider}+${synthesized.provider}`;
        billableCharacters = synthesized.billableCharacters;
        synthesisChunkCount = synthesized.chunkCount;
        await persistAudio(synthesized.audioBytes);
      } catch (edgeTtsError) {
        reportMediaJobFailure('dubbing.edge_tts', mediaJobFailurePayload(edgeTtsError, 'external_service'));
        const azureKey = process.env.AZURE_SPEECH_KEY;
        const azureRegion = process.env.AZURE_SPEECH_REGION;
        if (azureKey && azureRegion) {
          const synthesized = await synthesizeAzureDubbing({
            translatedSrt: result.translatedSrt,
            voice: job.voiceName as AzureEnglishVoice,
            subscriptionKey: azureKey,
            region: azureRegion,
          });
          provider = `${result.provider}+${synthesized.provider}`;
          billableCharacters = synthesized.billableCharacters;
          synthesisChunkCount = synthesized.chunkCount;
          await persistAudio(synthesized.audioBytes);
        }
      }
    }
    stage = 'database';
    const done = await updateDubbingJob(jobId, user.id, {
      status: 'done',
      translatedSrt: result.translatedSrt,
      dubbedAudioPath,
      dubbedAudioType,
      lipSync: 'skipped',
      provider,
      billableCharacters,
      synthesisChunkCount,
    });
    await removeSources();
    return NextResponse.json({
      status: 'done',
      srtUrl: resultUrl(req, jobId, 'subtitles.srt'),
      audioUrl: done?.dubbedAudioPath ? resultUrl(req, jobId, 'audio.wav') : undefined,
      lipSync: done?.lipSync ?? 'skipped',
      provider: done?.provider,
      voiceName: done?.voiceName,
      billableCharacters: done?.billableCharacters,
      synthesisChunkCount: done?.synthesisChunkCount,
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
