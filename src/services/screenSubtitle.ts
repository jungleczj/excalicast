'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { loadScreenRecordingWebm, updateScreenRecording } from '@/lib/db-client';

let _ffmpeg: FFmpeg | null = null;
async function getFfmpeg(): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

/**
 * Extract the audio track from a screen recording's webm so we can send only
 * the audio bytes to DashScope (their ASR doesn't need the video).
 *
 * Demux only — no re-encode — fast.
 */
async function extractAudio(recordingId: string): Promise<Blob> {
  const webm = await loadScreenRecordingWebm(recordingId);
  const ffmpeg = await getFfmpeg();
  await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));
  try {
    await ffmpeg.exec(['-i', 'input.webm', '-vn', '-c:a', 'copy', 'audio.webm']);
  } catch (err) {
    // Fallback: re-encode to opus if `copy` fails for any reason
    await ffmpeg.exec(['-i', 'input.webm', '-vn', '-c:a', 'libopus', '-b:a', '64k', 'audio.webm']);
  }
  const data = await ffmpeg.readFile('audio.webm');
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  try { await ffmpeg.deleteFile('input.webm'); } catch { /* */ }
  try { await ffmpeg.deleteFile('audio.webm'); } catch { /* */ }
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: 'audio/webm' });
}

export interface SubmitResult {
  jobId: string;
  mock: boolean;
  reason?: string;
}

/**
 * Submit the recording's audio to the DashScope ASR job queue.
 * Server endpoint validates Pro entitlement.
 */
export async function submitScreenSubtitleJob(recordingId: string): Promise<SubmitResult> {
  const audioBlob = await extractAudio(recordingId);
  const form = new FormData();
  form.append('recordingId', recordingId);
  form.append('audio', audioBlob, `${recordingId}.webm`);
  const res = await fetch('/api/asr/submit', { method: 'POST', body: form });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message ?? j.error ?? `submit failed: ${res.status}`);
  }
  return (await res.json()) as SubmitResult;
}

export interface PollResult {
  status: 'pending' | 'running' | 'done' | 'failed';
  srt?: string;
  error?: string;
}

export async function pollScreenSubtitleJob(jobId: string): Promise<PollResult> {
  const res = await fetch(`/api/asr/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return (await res.json()) as PollResult;
}

export async function saveScreenSubtitle(recordingId: string, srt: string): Promise<void> {
  await updateScreenRecording(recordingId, { subtitleSrt: srt });
}

export async function clearScreenSubtitle(recordingId: string): Promise<void> {
  await updateScreenRecording(recordingId, { subtitleSrt: undefined });
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
