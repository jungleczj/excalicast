'use client';

import { loadFullRecording } from '@/lib/db-client';

export interface SubmitResult {
  jobId: string;
  mock: boolean;
  reason?: string;
}

export async function submitSubtitleJob(recordingId: string): Promise<SubmitResult> {
  const { audioBlob } = await loadFullRecording(recordingId);
  if (!audioBlob) throw new Error('该录制没有音频，无法生成字幕');
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

export async function pollSubtitleJob(jobId: string): Promise<PollResult> {
  const res = await fetch(`/api/asr/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  const j = (await res.json()) as PollResult;
  return j;
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
