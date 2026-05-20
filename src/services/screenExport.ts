'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { getScreenRecording, loadScreenRecordingWebm } from '@/lib/db-client';
import { buildScreenWatermarkFilter } from '@/utils/screenWatermarkFilter';
import { buildSubtitleDrawtextFilters } from '@/utils/screenSubtitleFilter';
import { parseSrt } from '@/utils/srtParser';

let _ffmpeg: FFmpeg | null = null;
async function getFfmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

export type ScreenExportFormat = 'mp4' | 'mov' | 'webm';

export interface ScreenExportOptions {
  recordingId: string;
  format: ScreenExportFormat;
  withWatermark: boolean;          // false ONLY when current user is Pro at download-time
  burnSubtitles: boolean;          // when true and meta.subtitleSrt is present, burn cues into the video
  onProgress?: (ratio: number) => void;
  onPhase?: (phase: 'loading' | 'transcoding' | 'done') => void;
  onLog?: (message: string) => void;
}

interface FormatSpec {
  ext: string;
  mime: string;
  videoCodec: string[];
  audioCodec: string[];
}

const FORMATS: Record<ScreenExportFormat, FormatSpec> = {
  mp4: {
    ext: 'mp4',
    mime: 'video/mp4',
    videoCodec: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioCodec: ['-c:a', 'aac', '-b:a', '128k'],
  },
  mov: {
    // Same H.264+AAC content as MP4, just .mov container — Mac native / QuickTime / Final Cut friendly.
    ext: 'mov',
    mime: 'video/quicktime',
    videoCodec: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioCodec: ['-c:a', 'aac', '-b:a', '128k'],
  },
  webm: {
    ext: 'webm',
    mime: 'video/webm',
    videoCodec: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '8'],
    audioCodec: ['-c:a', 'libopus', '-b:a', '128k'],
  },
};

export async function exportScreenRecording(opts: ScreenExportOptions): Promise<Blob> {
  opts.onPhase?.('loading');
  opts.onProgress?.(0.02);

  const meta = await getScreenRecording(opts.recordingId);
  if (!meta) throw new Error(`recording_not_found: ${opts.recordingId}`);

  const webm = await loadScreenRecordingWebm(opts.recordingId);

  const needsBurn = opts.withWatermark || (opts.burnSubtitles && !!meta.subtitleSrt);
  const fmt = FORMATS[opts.format];

  // Fast path: format=webm + no filters → return the raw recorded webm as-is.
  // No transcode = instant download.
  if (opts.format === 'webm' && !needsBurn) {
    opts.onProgress?.(1);
    opts.onPhase?.('done');
    return new Blob([await webm.arrayBuffer()], { type: fmt.mime });
  }

  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.1);

  await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));

  // Watermark + subtitles share the same font file in ffmpeg FS.
  const needsFont = opts.withWatermark || (opts.burnSubtitles && !!meta.subtitleSrt);
  if (needsFont) {
    const ttf = await fetchFile('/fonts/watermark-latin.ttf');
    await ffmpeg.writeFile('watermark-latin.ttf', ttf);
  }

  opts.onPhase?.('transcoding');
  opts.onProgress?.(0.15);

  ffmpeg.on('progress', ({ progress }) => {
    opts.onProgress?.(0.15 + Math.min(1, Math.max(0, progress)) * 0.83);
  });

  // Build combined -vf chain: subtitles first (so watermark stays on top), then watermark.
  const filterParts: string[] = [];
  if (opts.burnSubtitles && meta.subtitleSrt) {
    const cues = parseSrt(meta.subtitleSrt);
    const subFilters = buildSubtitleDrawtextFilters(cues, meta.output.height);
    filterParts.push(...subFilters);
  }
  if (opts.withWatermark) {
    filterParts.push(buildScreenWatermarkFilter({
      hasCamera: meta.hasCamera,
      videoH: meta.output.height,
    }));
  }

  const outFile = `output.${fmt.ext}`;
  const args = ['-i', 'input.webm'];
  if (filterParts.length > 0) {
    args.push('-vf', filterParts.join(','));
  }
  args.push(...fmt.videoCodec, ...fmt.audioCodec, outFile);

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

  const data = await ffmpeg.readFile(outFile);
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  // Cleanup
  try { await ffmpeg.deleteFile('input.webm'); } catch { /* */ }
  try { await ffmpeg.deleteFile(outFile); } catch { /* */ }
  if (needsFont) {
    try { await ffmpeg.deleteFile('watermark-latin.ttf'); } catch { /* */ }
  }

  opts.onProgress?.(1);
  opts.onPhase?.('done');

  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: fmt.mime });
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
