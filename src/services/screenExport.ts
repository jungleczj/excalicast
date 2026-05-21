'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import {
  getScreenRecording,
  loadScreenRecordingCameraWebm,
  loadScreenRecordingWebm,
} from '@/lib/db-client';
import { buildScreenWatermarkFilter } from '@/utils/screenWatermarkFilter';
import { buildSubtitleDrawtextFilters } from '@/utils/screenSubtitleFilter';
import { parseSrt } from '@/utils/srtParser';
import type { CameraOverlayPosition } from '@/types/recording';

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
  /** Override the saved cameraOverlayPosition for this export. Only takes
   *  effect when bubbleSource === 'overlay'. */
  cameraOverlayPosition?: CameraOverlayPosition;
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

/**
 * Build the ffmpeg `overlay=x:y` expression for the 4 anchor positions.
 * `W` / `H` = main video frame, `w` / `h` = overlay (camera bubble) dimensions.
 */
function overlayPositionExpr(pos: CameraOverlayPosition, margin = 24): string {
  switch (pos) {
    case 'top-left':     return `${margin}:${margin}`;
    case 'top-right':    return `W-w-${margin}:${margin}`;
    case 'bottom-left':  return `${margin}:H-h-${margin}`;
    case 'bottom-right': return `W-w-${margin}:H-h-${margin}`;
  }
}

export async function exportScreenRecording(opts: ScreenExportOptions): Promise<Blob> {
  opts.onPhase?.('loading');
  opts.onProgress?.(0.02);

  const meta = await getScreenRecording(opts.recordingId);
  if (!meta) throw new Error(`recording_not_found: ${opts.recordingId}`);

  const screenWebm = await loadScreenRecordingWebm(opts.recordingId);

  // Pattern B decision: camera overlay is only added at export when bubbleSource === 'overlay'.
  // For 'in_screen' the camera is already baked into screen.webm via PiP capture.
  // For 'none' (camera not used) we don't need it at all.
  const wantOverlay = meta.bubbleSource === 'overlay' && meta.hasCamera;
  const cameraWebm = wantOverlay ? await loadScreenRecordingCameraWebm(opts.recordingId) : null;
  if (wantOverlay && !cameraWebm) {
    console.warn('[screenExport] bubbleSource=overlay but no camera.webm found — skipping overlay');
  }

  const camPos = opts.cameraOverlayPosition ?? meta.cameraOverlayPosition ?? 'bottom-right';
  const camBubblePx = Math.max(120, Math.round(meta.output.height * 0.22));

  const needsBurn = opts.withWatermark || (opts.burnSubtitles && !!meta.subtitleSrt) || (wantOverlay && !!cameraWebm);
  const fmt = FORMATS[opts.format];

  // Fast path: format=webm + no overlay + no watermark + no subtitle burn → return raw.
  if (opts.format === 'webm' && !needsBurn) {
    opts.onProgress?.(1);
    opts.onPhase?.('done');
    return new Blob([await screenWebm.arrayBuffer()], { type: fmt.mime });
  }

  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.1);

  await ffmpeg.writeFile('input.webm', new Uint8Array(await screenWebm.arrayBuffer()));
  if (cameraWebm) {
    await ffmpeg.writeFile('camera.webm', new Uint8Array(await cameraWebm.arrayBuffer()));
  }

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

  // Build filter chain. When camera overlay is present, we use -filter_complex
  // with named labels. Otherwise the simple -vf chain (single input) is enough.
  const args: string[] = ['-i', 'input.webm'];
  let usingComplex = false;

  if (cameraWebm) {
    // -filter_complex with two inputs
    args.push('-i', 'camera.webm');
    usingComplex = true;

    // Camera is input [1]. Round mask via geq alpha channel (copied from the
    // existing scene-replay export — proven approach).
    const camFilter =
      `[1:v]scale=${camBubblePx}:${camBubblePx}:force_original_aspect_ratio=increase,` +
      `crop=${camBubblePx}:${camBubblePx},hflip,format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-1,2)),0,255)'[cam]`;

    const overlay = `[0:v][cam]overlay=${overlayPositionExpr(camPos)}[v_with_cam]`;

    let curLabel = '[v_with_cam]';
    const stages = [camFilter, overlay];

    // Subtitles (drawtext per cue) — chain on curLabel
    if (opts.burnSubtitles && meta.subtitleSrt) {
      const cues = parseSrt(meta.subtitleSrt);
      const subFilters = buildSubtitleDrawtextFilters(cues, meta.output.height);
      if (subFilters.length > 0) {
        const subChain = subFilters.join(',');
        stages.push(`${curLabel}${subChain}[v_subbed]`);
        curLabel = '[v_subbed]';
      }
    }

    // Watermark — chain on curLabel
    if (opts.withWatermark) {
      const wmFilter = buildScreenWatermarkFilter({ hasCamera: meta.hasCamera, videoH: meta.output.height });
      stages.push(`${curLabel}${wmFilter}[v_final]`);
      curLabel = '[v_final]';
    }

    args.push('-filter_complex', stages.join(';'));
    args.push('-map', curLabel);
    args.push('-map', '0:a?');
  } else {
    // No camera overlay needed — simple -vf chain (subtitles + watermark)
    const filterParts: string[] = [];
    if (opts.burnSubtitles && meta.subtitleSrt) {
      const cues = parseSrt(meta.subtitleSrt);
      filterParts.push(...buildSubtitleDrawtextFilters(cues, meta.output.height));
    }
    if (opts.withWatermark) {
      filterParts.push(buildScreenWatermarkFilter({ hasCamera: meta.hasCamera, videoH: meta.output.height }));
    }
    if (filterParts.length > 0) {
      args.push('-vf', filterParts.join(','));
    }
  }

  args.push(...fmt.videoCodec, ...fmt.audioCodec);
  const outFile = `output.${fmt.ext}`;
  args.push(outFile);

  // Capture ffmpeg log tail for diagnostics
  let lastLogs = '';
  const logHandler = ({ message }: { message: string }) => {
    lastLogs += message + '\n';
    if (lastLogs.length > 4000) lastLogs = lastLogs.slice(-4000);
  };
  ffmpeg.on('log', logHandler);

  try {
    console.info('[screenExport]', 'running ffmpeg with args:', { complex: usingComplex, args });
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
  if (cameraWebm) {
    try { await ffmpeg.deleteFile('camera.webm'); } catch { /* */ }
  }
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
