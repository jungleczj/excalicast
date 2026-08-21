import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ensureDubbingJobChunks,
  findReusableDubbingJobChunks,
  getDubbingJob,
  listDubbingJobChunks,
  readLocalDubbingAsset,
  saveLocalDubbingAsset,
  updateDubbingJob,
  updateDubbingJobChunk,
  type DubbingJobChunk,
} from '@/lib/dubbingStore';
import { generateDubbingTranslation } from '@/services/dubbingProviders';
import {
  decodeCachedEdgeTtsChunk,
  planEdgeTtsChunks,
  synthesizeEdgeTtsChunk,
  type EdgeTtsPlannedChunk,
} from '@/services/edgeTtsProvider';
import type { AzureEnglishVoice } from '@/services/voiceProfile';
import { assembleTimedPcm16Wav, hasAudiblePcm16Audio } from '@/lib/dubbingAudio';
import {
  buildLocalizedTimingMap,
  localizedTimelineDuration,
  mapSrtToLocalizedTimeline,
  parseSpeechRatePercent,
} from '@/services/dubbingTiming';
import { mapWithConcurrency } from '@/utils/asyncPool';
import { mediaJobFailurePayload, mediaJobFailureStatus, reportMediaJobFailure } from '@/lib/mediaJobDiagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 6;
const ACTIVE_JOB_LEASE_MS = 90_000;

function responseFor(job: NonNullable<Awaited<ReturnType<typeof getDubbingJob>>>): Record<string, unknown> {
  return {
    status: job.status, provider: job.provider, voiceName: job.voiceName, phase: job.phase,
    totalChunks: job.totalChunks, completedChunks: job.completedChunks, elapsedMs: job.elapsedMs,
    etaMs: job.etaMs, decoder: job.decoder, fallbackReason: job.fallbackReason, error: job.error,
  };
}

function plannedForRow(row: DubbingJobChunk): EdgeTtsPlannedChunk {
  return {
    index: row.index, startMs: row.startMs, endMs: row.endMs, text: row.text,
    textHash: row.textHash, rate: row.speechRate,
  };
}

async function initializeChunks(job: NonNullable<Awaited<ReturnType<typeof getDubbingJob>>>, userId: string): Promise<void> {
  const planned = planEdgeTtsChunks(job.translatedSrt ?? '');
  const reusable = await findReusableDubbingJobChunks(userId, planned.map((chunk) => ({
    textHash: chunk.textHash, voiceName: job.voiceName!, speechRate: chunk.rate,
  })));
  const now = Date.now();
  await ensureDubbingJobChunks(planned.map((chunk) => {
    const cached = reusable.get(`${chunk.textHash}:${job.voiceName!}`);
    return {
      id: `${job.id}:${chunk.index}`, jobId: job.id, userId, index: chunk.index,
      startMs: chunk.startMs, endMs: chunk.endMs, text: chunk.text, textHash: chunk.textHash,
      voiceName: job.voiceName!, speechRate: chunk.rate,
      status: cached ? 'done' as const : 'pending' as const,
      attemptCount: 0, mp3Path: cached?.mp3Path, durationMs: cached?.durationMs,
      createdAt: now, updatedAt: now,
    };
  }));
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ status: 'failed', error: 'unauthenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ status: 'failed', error: 'missing_job_id' }, { status: 400 });
  let job = await getDubbingJob(body.jobId, user.id);
  if (!job) return NextResponse.json({ status: 'failed', error: 'job_not_found' }, { status: 404 });
  if (job.status === 'done' || job.status === 'failed') return NextResponse.json(responseFor(job));
  if (job.status === 'running' && Date.now() - job.updatedAt < ACTIVE_JOB_LEASE_MS) {
    return NextResponse.json(responseFor(job));
  }

  try {
    if (!job.translatedSrt?.trim()) {
      await updateDubbingJob(job.id, user.id, { status: 'running', phase: 'translating', error: undefined });
      const translation = await generateDubbingTranslation(job.sourceSrt ?? '');
      job = (await updateDubbingJob(job.id, user.id, {
        status: 'pending', phase: 'synthesizing', translatedSrt: translation.translatedSrt,
        provider: translation.provider, elapsedMs: Date.now() - job.createdAt,
      }))!;
      await initializeChunks(job, user.id);
      const chunks = await listDubbingJobChunks(job.id, user.id);
      job = (await updateDubbingJob(job.id, user.id, {
        totalChunks: chunks.length, completedChunks: 0, synthesisChunkCount: chunks.length,
      }))!;
      return NextResponse.json(responseFor(job));
    }

    let chunks = await listDubbingJobChunks(job.id, user.id);
    if (chunks.length === 0) {
      await initializeChunks(job, user.id);
      chunks = await listDubbingJobChunks(job.id, user.id);
    }

    const adaptiveConcurrency = chunks.some((chunk) => chunk.status === 'failed') ? 3 : BATCH_SIZE;
    const pending = chunks
      .filter((chunk) => chunk.status !== 'done' && chunk.attemptCount < 3)
      .slice(0, adaptiveConcurrency);
    if (pending.length > 0) {
      await updateDubbingJob(job.id, user.id, { status: 'running', phase: 'synthesizing', error: undefined });
      await mapWithConcurrency(pending, adaptiveConcurrency, async (chunk) => {
        await updateDubbingJobChunk(chunk.id, user.id, {
          status: 'running', attemptCount: chunk.attemptCount + 1, error: undefined,
        });
        try {
          const synthesized = await synthesizeEdgeTtsChunk(plannedForRow(chunk), job!.voiceName as AzureEnglishVoice);
          let mp3Path: string;
          if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            const admin = createSupabaseAdminClient();
            mp3Path = `${user.id}/${job!.recordingId}/jobs/dubbing/${job!.id}/chunks/${chunk.index}.mp3`;
            const bytes = new Uint8Array(synthesized.mp3);
            const { error } = await admin.storage.from('recordings').upload(
              mp3Path,
              new Blob([bytes], { type: 'audio/mpeg' }),
              { contentType: 'audio/mpeg', cacheControl: '0', upsert: true },
            );
            if (error) throw error;
          } else {
            mp3Path = await saveLocalDubbingAsset(job!.id, `chunk-${chunk.index}.mp3`, synthesized.mp3);
          }
          await updateDubbingJobChunk(chunk.id, user.id, {
            status: 'done', mp3Path, durationMs: Math.round(synthesized.durationMs),
            speechRate: synthesized.rate, error: undefined,
          });
        } catch (error) {
          await updateDubbingJobChunk(chunk.id, user.id, {
            status: 'failed', error: error instanceof Error ? error.message : 'edge_tts_chunk_failed',
          });
        }
      });
    }

    chunks = await listDubbingJobChunks(job.id, user.id);
    const completed = chunks.filter((chunk) => chunk.status === 'done').length;
    const exhausted = chunks.filter((chunk) => chunk.status !== 'done' && chunk.attemptCount >= 3);
    const elapsedMs = Date.now() - job.createdAt;
    const etaMs = completed > 0 ? Math.max(0, Math.round(elapsedMs / completed * (chunks.length - completed))) : undefined;
    if (exhausted.length > 0) {
      job = (await updateDubbingJob(job.id, user.id, {
        status: 'done', phase: 'saving', completedChunks: completed, totalChunks: chunks.length,
        elapsedMs, etaMs: undefined, decoder: 'mpg123-wasm',
        fallbackReason: exhausted[0].error ?? 'edge_tts_unavailable',
        provider: `${job.provider?.split('+')[0] ?? 'deepseek-v4-flash'}+kokoro-local-required`,
      }))!;
      return NextResponse.json(responseFor(job));
    }
    if (completed < chunks.length) {
      job = (await updateDubbingJob(job.id, user.id, {
        status: 'pending', phase: 'synthesizing', completedChunks: completed,
        totalChunks: chunks.length, elapsedMs, etaMs,
      }))!;
      return NextResponse.json(responseFor(job));
    }

    await updateDubbingJob(job.id, user.id, { status: 'running', phase: 'decoding', completedChunks: completed });
    const admin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : undefined;
    const decoded = await mapWithConcurrency(chunks, 2, async (chunk) => {
      let mp3: Uint8Array | null = null;
      if (admin && chunk.mp3Path) {
        const { data, error } = await admin.storage.from('recordings').download(chunk.mp3Path);
        if (error) throw error;
        mp3 = new Uint8Array(await data.arrayBuffer());
      } else if (chunk.mp3Path) {
        mp3 = await readLocalDubbingAsset(chunk.mp3Path);
      }
      if (!mp3) throw new Error(`dubbing_chunk_asset_missing:${chunk.index}`);
      return decodeCachedEdgeTtsChunk(plannedForRow(chunk), mp3);
    });
    await updateDubbingJob(job.id, user.id, { status: 'running', phase: 'assembling' });
    const timingMap = buildLocalizedTimingMap(decoded.map((chunk) => ({
      sourceStartMs: chunk.startMs,
      sourceEndMs: chunk.endMs,
      audioDurationMs: chunk.durationMs,
      speechRatePercent: parseSpeechRatePercent(chunk.rate),
    })));
    const localizedSrt = mapSrtToLocalizedTimeline(job.translatedSrt ?? '', timingMap);
    const minimumDurationMs = localizedTimelineDuration(timingMap);
    const audioBytes = assembleTimedPcm16Wav(
      decoded.map((chunk, index) => ({ startMs: timingMap[index].audioStartMs, wav: chunk.wav })),
      minimumDurationMs,
    );
    if (!hasAudiblePcm16Audio(audioBytes)) throw new Error('dubbing_audio_quality_gate_failed');

    await updateDubbingJob(job.id, user.id, { status: 'running', phase: 'uploading' });
    let dubbedAudioPath: string;
    if (admin) {
      dubbedAudioPath = `${user.id}/${job.recordingId}/jobs/dubbing/${job.id}-audio.wav`;
      const bytes = new Uint8Array(audioBytes);
      const { error } = await admin.storage.from('recordings').upload(
        dubbedAudioPath,
        new Blob([bytes], { type: 'audio/wav' }),
        { contentType: 'audio/wav', cacheControl: '0', upsert: true },
      );
      if (error) throw error;
    } else {
      dubbedAudioPath = await saveLocalDubbingAsset(job.id, 'audio.wav', audioBytes);
    }
    job = (await updateDubbingJob(job.id, user.id, {
      status: 'done', phase: 'saving', dubbedAudioPath, dubbedAudioType: 'audio/wav', lipSync: 'skipped',
      localizedSrt, timingMap,
      provider: `${job.provider?.split('+')[0] ?? 'deepseek-v4-flash'}+edge-tts`,
      billableCharacters: chunks.reduce((total, chunk) => total + chunk.text.length, 0),
      synthesisChunkCount: chunks.length, completedChunks: chunks.length, totalChunks: chunks.length,
      elapsedMs: Date.now() - job.createdAt, etaMs: 0, decoder: 'mpg123-wasm',
      fallbackReason: undefined, error: undefined,
    }))!;
    return NextResponse.json(responseFor(job));
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'external_service');
    reportMediaJobFailure('dubbing.process', failure);
    job = (await updateDubbingJob(job.id, user.id, {
      status: 'failed', error: failure.cause, elapsedMs: Date.now() - job.createdAt,
    }).catch(() => job))!;
    return NextResponse.json(
      { ...responseFor(job), code: failure.code, stage: failure.stage },
      { status: mediaJobFailureStatus(failure) },
    );
  }
}
