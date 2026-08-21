'use client';

import {
  getLatestMediaTask,
  loadRecordingMediaTracks,
  saveLocalizedTrack,
  saveMediaTask,
} from '@/lib/db-client';
import type { LocalizedTimingSegment, LocalizedTrack } from '@/types/recording';
import { generateKokoroDubbingAudio, type KokoroDubbingProgress } from '@/services/kokoroDubbingClient';
import { parseMediaJobResponse } from '@/services/mediaJobClient';
import { shouldUseMediaJobMocks } from '@/services/mediaJobMode';
import { removePrivateJobAssets, uploadPrivateJobAsset } from '@/services/privateMediaUpload';
import { parsePcm16Wav } from '@/lib/dubbingAudio';
import type { AzureEnglishVoice, VoiceProfile } from '@/services/voiceProfile';

interface SubmitResponse { jobId: string; reused?: boolean }

interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  audioUrl?: string;
  voiceName?: string;
  billableCharacters?: number;
  synthesisChunkCount?: number;
  timingMap?: LocalizedTimingSegment[];
  durationMs?: number;
  phase?: 'translating' | 'synthesizing' | 'decoding' | 'assembling' | 'uploading' | 'saving';
  totalChunks?: number;
  completedChunks?: number;
  elapsedMs?: number;
  etaMs?: number;
  decoder?: string;
  fallbackReason?: string;
  error?: string;
}

export type DubbingProgressStage = 'translating' | 'model' | 'synthesis' | 'assembling' | 'saving';

export interface DubbingProgress {
  stage: DubbingProgressStage;
  progress: number;
  device?: 'webgpu' | 'wasm';
  completedChunks?: number;
  totalChunks?: number;
}

interface DubbingOptions {
  signal?: AbortSignal;
  allowLocalFallback?: boolean;
  onProgress?: (progress: DubbingProgress) => void;
  onCheckpoint?: (checkpoint: { remoteJobId: string; sourceAudioHash: string }) => void;
  persistTask?: boolean;
}

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 20 * 60_000;

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Dubbing cancelled', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException('Dubbing cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function audioFingerprint(blob: Blob): Promise<string> {
  const sample = await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', sample);
    const hex = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${blob.size}-${hex}`;
  }
  return `${blob.size}-${blob.type || 'audio'}-${sample.byteLength}`;
}

async function persistDubbingTask(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  progress: number;
  stage?: DubbingProgressStage;
  completedChunks?: number;
  totalChunks?: number;
  error?: string;
}): Promise<void> {
  const existing = await getLatestMediaTask(params.recordingId, 'dubbing');
  await saveMediaTask({
    id: `dubbing:${params.jobId}`,
    recordingId: params.recordingId,
    kind: 'dubbing',
    status: params.status,
    progress: params.progress,
    checkpoint: {
      remoteJobId: params.jobId,
      sourceAudioHash: params.sourceAudioHash,
      localStage: params.stage,
      completedChunks: params.completedChunks,
      totalChunks: params.totalChunks,
    },
    createdAt: existing?.id === `dubbing:${params.jobId}` ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
    error: params.error,
  });
}

async function pollDubbingJob(
  recordingId: string,
  jobId: string,
  sourceAudioHash: string,
  options: DubbingOptions,
): Promise<StatusResponse> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const processResponse = await fetch('/api/dubbing/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      cache: 'no-store',
      signal: options.signal,
    });
    const processStatus = await parseMediaJobResponse<StatusResponse>(processResponse);
    if (processStatus.status === 'done') {
      const statusResponse = await fetch(`/api/dubbing/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: 'no-store', signal: options.signal,
      });
      return parseMediaJobResponse<StatusResponse>(statusResponse);
    }
    const status = processStatus;
    if (status.status === 'failed') throw new Error(status.error ?? 'dubbing_failed');
    const chunkRatio = status.totalChunks && status.totalChunks > 0
      ? (status.completedChunks ?? 0) / status.totalChunks
      : 0;
    const stage: DubbingProgressStage = status.phase === 'synthesizing'
      ? 'synthesis'
      : status.phase === 'decoding' || status.phase === 'assembling'
        ? 'assembling'
        : status.phase === 'uploading' || status.phase === 'saving'
          ? 'saving'
          : 'translating';
    const progress = stage === 'translating'
      ? 0.12
      : stage === 'synthesis'
        ? 0.2 + chunkRatio * 0.65
        : stage === 'assembling'
          ? 0.9
          : 0.97;
    options.onProgress?.({
      stage,
      progress,
      completedChunks: status.completedChunks,
      totalChunks: status.totalChunks,
    });
    if (options.persistTask !== false) {
      await persistDubbingTask({
        recordingId, jobId, sourceAudioHash, status: 'running', progress, stage,
        completedChunks: status.completedChunks, totalChunks: status.totalChunks,
      });
    }
    await wait(POLL_INTERVAL_MS, options.signal);
  }
  throw new Error('dubbing_timeout');
}

async function fetchRequiredText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`asset_fetch_failed_${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error('translated_subtitles_empty');
  return text;
}

async function fetchRequiredBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`asset_fetch_failed_${res.status}`);
  const blob = await res.blob();
  if (blob.size < 44) throw new Error('dubbing_audio_too_small');
  return blob;
}

function mapKokoroProgress(value: KokoroDubbingProgress): DubbingProgress {
  const base = value.stage === 'model' ? 0.35 : value.stage === 'synthesis' ? 0.58 : 0.94;
  const span = value.stage === 'model' ? 0.23 : value.stage === 'synthesis' ? 0.36 : 0.04;
  return {
    stage: value.stage,
    progress: base + value.progress * span,
    device: value.device,
    completedChunks: value.completedChunks,
    totalChunks: value.totalChunks,
  };
}

async function finishEnglishDubbingTrack(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
  voiceProfile?: VoiceProfile;
  options?: DubbingOptions;
}): Promise<LocalizedTrack> {
  const options = params.options ?? {};
  try {
    options.onProgress?.({ stage: 'translating', progress: 0.1 });
    const status = await pollDubbingJob(params.recordingId, params.jobId, params.sourceAudioHash, options);
    if (!status.srtUrl) throw new Error('missing_translated_subtitles');
    const translatedSrt = await fetchRequiredText(status.srtUrl, options.signal);
    let lastPersistedAt = 0;
    if (!status.audioUrl && options.allowLocalFallback !== true) {
      throw new Error('dubbing_local_fallback_required');
    }
    const audioBlob = status.audioUrl
      ? await fetchRequiredBlob(status.audioUrl, options.signal)
      : await generateKokoroDubbingAudio(translatedSrt, {
      voice: status.voiceName === 'en-US-AndrewMultilingualNeural' ? 'am_adam' : 'af_heart',
      signal: options.signal,
      onProgress: (localProgress) => {
        const progress = mapKokoroProgress(localProgress);
        options.onProgress?.(progress);
        if (Date.now() - lastPersistedAt < 600) return;
        lastPersistedAt = Date.now();
        if (options.persistTask !== false) {
          void persistDubbingTask({
            recordingId: params.recordingId,
            jobId: params.jobId,
            sourceAudioHash: params.sourceAudioHash,
            status: 'running',
            progress: progress.progress,
            stage: progress.stage,
            completedChunks: progress.completedChunks,
            totalChunks: progress.totalChunks,
          }).catch(() => undefined);
        }
      },
    });
    const audioInfo = parsePcm16Wav(new Uint8Array(await audioBlob.arrayBuffer()));
    options.onProgress?.({ stage: 'saving', progress: 0.99 });
    const track: LocalizedTrack = {
      id: `localized-${params.recordingId}-${Date.now()}`,
      recordingId: params.recordingId,
      targetLang: 'en',
      status: 'ready',
      createdAt: Date.now(),
      provider: status.provider ?? 'deepseek-v4-flash+kokoro-local',
      sourceAudioHash: params.sourceAudioHash,
      translatedSrt,
      timingMap: status.timingMap,
      durationMs: status.durationMs ?? audioInfo.durationMs,
      audioBlob,
      sampleRate: audioInfo.sampleRate,
      channelCount: audioInfo.channels,
      totalFrames: Math.floor(audioInfo.samples.length / audioInfo.channels),
      voiceName: status.voiceName,
      voiceProfile: params.voiceProfile ? {
        register: params.voiceProfile.register,
        confidence: params.voiceProfile.confidence,
        medianPitchHz: params.voiceProfile.medianPitchHz,
        analyzerVersion: params.voiceProfile.analyzerVersion,
      } : undefined,
      billableCharacters: status.billableCharacters,
      synthesisChunkCount: status.synthesisChunkCount,
      lipSync: 'skipped',
    };
    await saveLocalizedTrack(track, true);
    if (options.persistTask !== false) {
      await persistDubbingTask({
        recordingId: params.recordingId,
        jobId: params.jobId,
        sourceAudioHash: params.sourceAudioHash,
        status: 'completed',
        progress: 1,
        stage: 'saving',
      });
    }
    return track;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    if (options.persistTask !== false) {
      await persistDubbingTask({
        recordingId: params.recordingId,
        jobId: params.jobId,
        sourceAudioHash: params.sourceAudioHash,
        status: aborted ? 'paused' : 'failed',
        progress: 0,
        error: aborted ? 'interrupted' : error instanceof Error ? error.message : 'dubbing_failed',
      });
    }
    throw error;
  }
}

export async function resumeEnglishDubbingTrack(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
} & DubbingOptions): Promise<LocalizedTrack> {
  const { recordingId, jobId, sourceAudioHash, ...options } = params;
  return finishEnglishDubbingTrack({ recordingId, jobId, sourceAudioHash, options });
}

export async function createEnglishDubbingTrack(params: {
  recordingId: string;
  sourceSrt?: string | null;
  voiceName: AzureEnglishVoice;
  voiceProfile?: VoiceProfile;
} & DubbingOptions): Promise<LocalizedTrack> {
  const sourceSrt = params.sourceSrt?.trim();
  if (!sourceSrt) throw new Error('dubbing_subtitles_required');
  const media = await loadRecordingMediaTracks(params.recordingId, ['audio']);
  if (!media.audioBlob) throw new Error('no_audio');

  const sourceAudioHash = await audioFingerprint(media.audioBlob);
  const nonce = crypto.randomUUID();
  const localMock = shouldUseMediaJobMocks(process.env.NEXT_PUBLIC_MEDIA_JOB_MOCKS)
    || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  let proofAsset: Awaited<ReturnType<typeof uploadPrivateJobAsset>> | null = null;
  if (!localMock) {
    proofAsset = await uploadPrivateJobAsset({
      recordingId: params.recordingId,
      kind: 'dubbing',
      jobNonce: nonce,
      filename: 'authorization.txt',
      blob: new Blob([nonce], { type: 'text/plain' }),
      signal: params.signal,
    });
  }
  try {
    const submit = await fetch('/api/dubbing/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        recordingId: params.recordingId,
        targetLang: 'en',
        sourceAudioHash,
        sourceSrt,
        voiceName: params.voiceName,
        voiceRegister: params.voiceProfile?.register ?? 'uncertain',
        voiceConfidence: params.voiceProfile?.confidence ?? 0,
        localMock,
        ...(proofAsset ? {
          assetPath: proofAsset.path,
          bytes: proofAsset.bytes,
          mimeType: proofAsset.mimeType,
        } : {}),
      }),
    });
    const { jobId, reused } = await parseMediaJobResponse<SubmitResponse>(submit);
    if (reused && proofAsset) {
      await removePrivateJobAssets([proofAsset.path]);
      proofAsset = null;
    }
    params.onCheckpoint?.({ remoteJobId: jobId, sourceAudioHash });
    if (params.persistTask !== false) {
      await persistDubbingTask({
        recordingId: params.recordingId,
        jobId,
        sourceAudioHash,
        status: 'running',
        progress: 0.08,
        stage: 'translating',
      });
    }
    return finishEnglishDubbingTrack({
      recordingId: params.recordingId,
      jobId,
      sourceAudioHash,
      voiceProfile: params.voiceProfile,
      options: params,
    });
  } catch (error) {
    await removePrivateJobAssets([proofAsset?.path]);
    throw error;
  }
}
