'use client';

import { loadRecordingMediaTracks } from '@/lib/db-client';
import { uploadPrivateJobAsset } from '@/services/privateMediaUpload';
import { parseMediaJobResponse } from '@/services/mediaJobClient';

export interface SubmitResult {
  jobId: string;
  mock: boolean;
  reason?: string;
}

export async function submitSubtitleJob(
  recordingId: string,
  options?: { signal?: AbortSignal; audioBlob?: Blob; onUploadProgress?: (uploaded: number, total: number) => void },
): Promise<SubmitResult> {
  const audioBlob = options?.audioBlob ?? (await loadRecordingMediaTracks(recordingId, ['audio'])).audioBlob;
  if (!audioBlob) throw new Error('该录制没有音频，无法生成字幕');
  const localMock = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const asset = localMock ? null : await uploadPrivateJobAsset({
    recordingId,
    kind: 'asr',
    jobNonce: crypto.randomUUID(),
    filename: 'audio.webm',
    blob: audioBlob,
    signal: options?.signal,
    onProgress: options?.onUploadProgress,
  });
  const res = await fetch('/api/asr/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(asset ? { recordingId, assetPath: asset.path, bytes: asset.bytes, mimeType: asset.mimeType } : { recordingId, localMock: true }),
    signal: options?.signal,
  });
  return parseMediaJobResponse<SubmitResult>(res);
}

export interface PollResult {
  status: 'pending' | 'running' | 'done' | 'failed';
  srt?: string;
  error?: string;
}

export async function pollSubtitleJob(jobId: string): Promise<PollResult> {
  const res = await fetch(`/api/asr/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return parseMediaJobResponse<PollResult>(res);
}

export function downloadSrt(srt: string, filename: string): void {
  const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.srt') ? filename : `${filename}.srt`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
