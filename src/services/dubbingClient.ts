'use client';

import { loadFullRecording } from '@/lib/db-client';
import type { LocalizedTrack } from '@/types/recording';

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
const POLL_TIMEOUT_MS = 120_000;

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

async function parseJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null) as T | null;
  if (!res.ok) {
    const message = json && typeof json === 'object' && 'error' in json
      ? String((json as { error?: unknown }).error)
      : `request_failed_${res.status}`;
    throw new Error(message);
  }
  if (!json) throw new Error('invalid_response');
  return json;
}

async function pollDubbingJob(jobId: string): Promise<StatusResponse> {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(`/api/dubbing/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const status = await parseJson<StatusResponse>(res);
    if (status.status === 'done') return status;
    if (status.status === 'failed') throw new Error(status.error ?? 'dubbing_failed');
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

export async function createEnglishDubbingTrack(params: {
  recordingId: string;
  sourceSrt?: string | null;
}): Promise<LocalizedTrack> {
  const full = await loadFullRecording(params.recordingId);
  if (!full.audioBlob) throw new Error('no_audio');

  const sourceAudioHash = await audioFingerprint(full.audioBlob);
  const form = new FormData();
  form.append('recordingId', params.recordingId);
  form.append('targetLang', 'en');
  form.append('sourceAudioHash', sourceAudioHash);
  if (params.sourceSrt?.trim()) form.append('sourceSrt', params.sourceSrt);
  form.append('audio', full.audioBlob, full.audioBlob.type.includes('wav') ? 'source.wav' : 'source.webm');
  if (full.cameraBlob) {
    form.append('camera', full.cameraBlob, full.cameraBlob.type.includes('mp4') ? 'camera.mp4' : 'camera.webm');
  }

  const submit = await fetch('/api/dubbing/submit', { method: 'POST', body: form });
  const { jobId } = await parseJson<SubmitResponse>(submit);
  const status = await pollDubbingJob(jobId);
  if (!status.srtUrl || !status.audioUrl) throw new Error('missing_dubbing_assets');

  const [translatedSrt, audioBlob, cameraBlob] = await Promise.all([
    fetchRequiredText(status.srtUrl),
    fetchRequiredBlob(status.audioUrl, 'audio/wav'),
    status.cameraUrl ? fetchRequiredBlob(status.cameraUrl, 'video/webm') : Promise.resolve(undefined),
  ]);

  return {
    id: `localized-${params.recordingId}-${Date.now()}`,
    recordingId: params.recordingId,
    targetLang: 'en',
    status: 'ready',
    createdAt: Date.now(),
    provider: status.provider ?? 'dubbing',
    sourceAudioHash,
    translatedSrt,
    audioBlob,
    cameraBlob,
    lipSync: status.lipSync ?? (cameraBlob ? 'done' : 'skipped'),
  };
}
