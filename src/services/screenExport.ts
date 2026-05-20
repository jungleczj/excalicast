'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { getScreenRecording, loadScreenRecordingWebm } from '@/lib/db-client';
import { buildScreenWatermarkFilter } from '@/utils/screenWatermarkFilter';

let _ffmpeg: FFmpeg | null = null;
async function getFfmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

export interface ScreenExportOptions {
  recordingId: string;
  withWatermark: boolean;          // false ONLY when current user is Pro at download-time
  onProgress?: (ratio: number) => void;
  onPhase?: (phase: 'loading' | 'transcoding' | 'done') => void;
  onLog?: (message: string) => void;
}

export async function exportScreenRecording(opts: ScreenExportOptions): Promise<Blob> {
  opts.onPhase?.('loading');
  opts.onProgress?.(0.02);

  const meta = await getScreenRecording(opts.recordingId);
  if (!meta) throw new Error(`recording_not_found: ${opts.recordingId}`);

  const webm = await loadScreenRecordingWebm(opts.recordingId);
  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.1);

  await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));

  if (opts.withWatermark) {
    const ttf = await fetchFile('/fonts/watermark-latin.ttf');
    await ffmpeg.writeFile('watermark-latin.ttf', ttf);
  }

  opts.onPhase?.('transcoding');
  opts.onProgress?.(0.15);

  ffmpeg.on('progress', ({ progress }) => {
    opts.onProgress?.(0.15 + Math.min(1, Math.max(0, progress)) * 0.83);
  });

  const args = ['-i', 'input.webm'];
  if (opts.withWatermark) {
    const filter = buildScreenWatermarkFilter({
      hasCamera: meta.hasCamera,
      videoH: meta.output.height,
    });
    args.push('-vf', filter);
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    'output.mp4',
  );

  // Capture ffmpeg log into a buffer in case exec fails — so the caller / user
  // sees the real error instead of a generic "exec failed".
  let lastLogs = '';
  const logHandler = ({ message }: { message: string }) => {
    lastLogs += message + '\n';
    if (lastLogs.length > 4000) lastLogs = lastLogs.slice(-4000);
  };
  ffmpeg.on('log', logHandler);

  try {
    await ffmpeg.exec(args);
  } catch (err) {
    ffmpeg.off('log', logHandler);
    const msg = err instanceof Error ? err.message : 'ffmpeg_exec_failed';
    throw new Error(`${msg}\n\n--- ffmpeg log tail ---\n${lastLogs}`);
  }
  ffmpeg.off('log', logHandler);

  const data = await ffmpeg.readFile('output.mp4');
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  // Cleanup
  try { await ffmpeg.deleteFile('input.webm'); } catch { /* */ }
  try { await ffmpeg.deleteFile('output.mp4'); } catch { /* */ }
  if (opts.withWatermark) {
    try { await ffmpeg.deleteFile('watermark-latin.ttf'); } catch { /* */ }
  }

  opts.onProgress?.(1);
  opts.onPhase?.('done');

  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: 'video/mp4' });
}

export function downloadMp4Blob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
