'use client';

import {
  getLatestMediaTask,
  loadRecordingMediaTracks,
  saveLocalizedTrack,
  saveMediaTask,
} from '@/lib/db-client';
import type { LocalizedTrack } from '@/types/recording';
import { removePrivateJobAssets, uploadPrivateJobAsset } from '@/services/privateMediaUpload';
import { parseMediaJobResponse } from '@/services/mediaJobClient';

interface SubmitResponse {
  jobId: string;
}

interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  srtUrl?: string;
  audioUrl?: string;
  cameraUrl?: string;
  lipSync?: 'done' | 'skipped' | 'failed';
  provider?: string;
  error?: string;
}

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 5 * 60_000;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function audioFingerprint(blob: Blob): Promise<string> {
  const sample = await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', sample);
    const hex = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, '0')).join('');
    return `${blob.size}-${hex}`;
  }
  return `${blob.size}-${blob.type || 'audio'}-${sample.byteLength}`;
}

async function persistDubbingTask(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  error?: string;
}): Promise<void> {
  const existing = await getLatestMediaTask(params.recordingId, 'dubbing');
  await saveMediaTask({
    id: `dubbing:${params.jobId}`,
    recordingId: params.recordingId,
    kind: 'dubbing',
    status: params.status,
    progress: params.progress,
    checkpoint: { remoteJobId: params.jobId, sourceAudioHash: params.sourceAudioHash },
    createdAt: existing?.id === `dubbing:${params.jobId}` ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
    error: params.error,
  });
}

async function pollDubbingJob(
  recordingId: string,
  jobId: string,
  sourceAudioHash: string,
): Promise<StatusResponse> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(`/api/dubbing/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const status = await parseMediaJobResponse<StatusResponse>(res);
    if (status.status === 'done') return status;
    if (status.status === 'failed') {
      await persistDubbingTask({
        recordingId, jobId, sourceAudioHash, status: 'failed', progress: 0, error: status.error ?? 'dubbing_failed',
      });
      throw new Error(status.error ?? 'dubbing_failed');
    }
    await persistDubbingTask({
      recordingId,
      jobId,
      sourceAudioHash,
      status: 'running',
      progress: status.status === 'running' ? 0.7 : 0.35,
    });
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error('dubbing_timeout');
}

async function fetchRequiredBlob(url: string, fallbackType: string): Promise<Blob> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`asset_fetch_failed_${res.status}`);
  const blob = await res.blob();
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: fallbackType });
}

async function fetchRequiredText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`asset_fetch_failed_${res.status}`);
  return res.text();
}

async function finishEnglishDubbingTrack(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
}): Promise<LocalizedTrack> {
  try {
    const status = await pollDubbingJob(params.recordingId, params.jobId, params.sourceAudioHash);
    if (!status.srtUrl || !status.audioUrl) throw new Error('missing_dubbing_assets');

    const [translatedSrt, audioBlob, cameraBlob] = await Promise.all([
      fetchRequiredText(status.srtUrl),
      fetchRequiredBlob(status.audioUrl, 'audio/wav'),
      status.cameraUrl ? fetchRequiredBlob(status.cameraUrl, 'video/webm') : Promise.resolve(undefined),
    ]);
    const track: LocalizedTrack = {
      id: `localized-${params.recordingId}-${Date.now()}`,
      recordingId: params.recordingId,
      targetLang: 'en',
      status: 'ready',
      createdAt: Date.now(),
      provider: status.provider ?? 'dubbing',
      sourceAudioHash: params.sourceAudioHash,
      translatedSrt,
      audioBlob,
      cameraBlob,
      lipSync: status.lipSync ?? (cameraBlob ? 'done' : 'skipped'),
    };
    // Persist the materialized result before marking the durable task complete.
    // A route unmount may remove the panel consumer, but it must not orphan a
    // remotely completed and already downloaded dubbing result.
    await saveLocalizedTrack(track, true);
    await persistDubbingTask({
      recordingId: params.recordingId,
      jobId: params.jobId,
      sourceAudioHash: params.sourceAudioHash,
      status: 'completed',
      progress: 1,
    });
    return track;
  } catch (error) {
    await persistDubbingTask({
      recordingId: params.recordingId,
      jobId: params.jobId,
      sourceAudioHash: params.sourceAudioHash,
      status: 'failed',
      progress: 0,
      error: error instanceof Error ? error.message : 'dubbing_failed',
    });
    throw error;
  }
}

export async function resumeEnglishDubbingTrack(params: {
  recordingId: string;
  jobId: string;
  sourceAudioHash: string;
}): Promise<LocalizedTrack> {
  return finishEnglishDubbingTrack(params);
}

export async function createEnglishDubbingTrack(params: {
  recordingId: string;
  sourceSrt?: string | null;
}): Promise<LocalizedTrack> {
  const full = await loadRecordingMediaTracks(params.recordingId, ['audio', 'camera']);
  if (!full.audioBlob) throw new Error('no_audio');

  const sourceAudioHash = await audioFingerprint(full.audioBlob);
  const nonce = crypto.randomUUID();
  const localMock = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  let audioAsset: Awaited<ReturnType<typeof uploadPrivateJobAsset>> | null = null;
  let cameraAsset: Awaited<ReturnType<typeof uploadPrivateJobAsset>> | null = null;
  if (!localMock) {
    const uploads = await Promise.allSettled([
      uploadPrivateJobAsset({
        recordingId: params.recordingId, kind: 'dubbing', jobNonce: nonce,
        filename: full.audioBlob.type.includes('wav') ? 'source.wav' : 'source.webm',
        blob: full.audioBlob,
      }),
      full.cameraBlob ? uploadPrivateJobAsset({
        recordingId: params.recordingId, kind: 'dubbing', jobNonce: nonce,
        filename: full.cameraBlob.type.includes('mp4') ? 'camera.mp4' : 'camera.webm',
        blob: full.cameraBlob,
      }) : Promise.resolve(null),
    ]);
    audioAsset = uploads[0].status === 'fulfilled' ? uploads[0].value : null;
    cameraAsset = uploads[1].status === 'fulfilled' ? uploads[1].value : null;
    const failed = uploads.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) {
      await removePrivateJobAssets([audioAsset?.path, cameraAsset?.path]);
      throw failed.reason;
    }
  }
  const submit = await fetch('/api/dubbing/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordingId: params.recordingId,
      targetLang: 'en',
      sourceAudioHash,
      sourceSrt: params.sourceSrt?.trim() || undefined,
      localMock,
      ...(audioAsset ? {
        assetPath: audioAsset.path, bytes: audioAsset.bytes, mimeType: audioAsset.mimeType,
      } : {}),
      ...(cameraAsset ? {
        cameraAssetPath: cameraAsset.path, cameraBytes: cameraAsset.bytes, cameraMimeType: cameraAsset.mimeType,
      } : {}),
    }),
  });
  const { jobId } = await parseMediaJobResponse<SubmitResponse>(submit);
  await persistDubbingTask({
    recordingId: params.recordingId,
    jobId,
    sourceAudioHash,
    status: 'running',
    progress: 0.2,
  });
  return finishEnglishDubbingTrack({ recordingId: params.recordingId, jobId, sourceAudioHash });
}
