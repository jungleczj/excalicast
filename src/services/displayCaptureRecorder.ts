'use client';

import { getClientDb } from '@/lib/db-client';
import type { RecordingSourceConfig, RecordingSourceKind, SourceCropWindow } from '@/types/recording';

export interface DisplayCaptureHandle {
  sourceStream: MediaStream;
  recordedStream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}

function mimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  return 'video/webm';
}

type DisplayVideoConstraints = MediaTrackConstraints & {
  displaySurface?: 'browser' | 'window' | 'monitor';
  cursor?: 'always' | 'motion' | 'never';
  resizeMode?: 'none' | 'crop-and-scale';
  logicalSurface?: boolean;
};

type DisplayMediaOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'exclude' | 'window' | 'system';
};

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function videoTrackSettings(stream: MediaStream): MediaTrackSettings {
  return stream.getVideoTracks()[0]?.getSettings?.() ?? {};
}

function sourceFrameRate(stream: MediaStream): number {
  const fps = videoTrackSettings(stream).frameRate;
  return clamp(Math.round(typeof fps === 'number' && fps > 0 ? fps : 60), 15, 60);
}

function sourcePixelSize(stream: MediaStream): { width: number; height: number } {
  const settings = videoTrackSettings(stream);
  return {
    width: even(typeof settings.width === 'number' && settings.width > 0 ? settings.width : 1920),
    height: even(typeof settings.height === 'number' && settings.height > 0 ? settings.height : 1080),
  };
}

function bitrateFor(stream: MediaStream, kind: RecordingSourceKind): number {
  const { width, height } = sourcePixelSize(stream);
  const fps = sourceFrameRate(stream);
  const pixelsPerSecond = width * height * fps;
  // 桌面/窗口文字边缘对压缩更敏感。这里按源像素和帧率动态估算，避免 4K/高刷被 6Mbps 糊掉。
  const bitsPerPixel = kind === 'selected_area' ? 0.12 : 0.16;
  return clamp(Math.round(pixelsPerSecond * bitsPerPixel), 12_000_000, 90_000_000);
}

export async function acquireDisplayStream(source: RecordingSourceConfig): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('display_capture_not_supported');
  }
  const video: DisplayVideoConstraints = {
    frameRate: { ideal: 60, max: 60 },
    cursor: 'always',
    resizeMode: 'none',
    logicalSurface: true,
    ...(source.displaySurface ? { displaySurface: source.displaySurface } : {}),
  };
  const options: DisplayMediaOptions = {
    video,
    audio: source.captureSystemAudio ? true : false,
    ...(source.kind === 'current_tab' ? { preferCurrentTab: true } : {}),
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    systemAudio: source.captureSystemAudio ? 'include' : 'exclude',
    windowAudio: source.captureSystemAudio ? 'system' : 'exclude',
  };
  return navigator.mediaDevices.getDisplayMedia(options);
}

export async function getDisplayStreamPixelSize(stream: MediaStream): Promise<{ width: number; height: number; frameRate?: number }> {
  const settings = videoTrackSettings(stream);
  if (settings.width && settings.height) {
    return {
      width: even(settings.width),
      height: even(settings.height),
      frameRate: settings.frameRate ? Math.round(settings.frameRate) : undefined,
    };
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
    else video.onloadedmetadata = () => resolve();
  });
  const size = {
    width: even(video.videoWidth || 1920),
    height: even(video.videoHeight || 1080),
    frameRate: settings.frameRate ? Math.round(settings.frameRate) : undefined,
  };
  video.pause();
  video.srcObject = null;
  return size;
}

function cropRect(
  crop: SourceCropWindow | undefined,
  sourceW: number,
  sourceH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!crop) return { sx: 0, sy: 0, sw: even(sourceW), sh: even(sourceH) };
  const sx = clamp(Math.round(crop.rx * sourceW), 0, Math.max(0, sourceW - 2));
  const sy = clamp(Math.round(crop.ry * sourceH), 0, Math.max(0, sourceH - 2));
  const maxW = Math.max(2, sourceW - sx);
  const maxH = Math.max(2, sourceH - sy);
  return {
    sx,
    sy,
    sw: even(clamp(Math.round(crop.rw * sourceW), 2, maxW)),
    sh: even(clamp(Math.round(crop.rh * sourceH), 2, maxH)),
  };
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { sx: number; sy: number; sw: number; sh: number },
): void {
  ctx.clearRect(0, 0, crop.sw, crop.sh);
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
}

async function createSelectedAreaStream(
  sourceStream: MediaStream,
  source: RecordingSourceConfig,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
    else video.onloadedmetadata = () => resolve();
  });

  const crop = source.sourceCropWindow;
  const sourceW = even(video.videoWidth || sourcePixelSize(sourceStream).width);
  const sourceH = even(video.videoHeight || sourcePixelSize(sourceStream).height);
  const rect = cropRect(crop, sourceW, sourceH);
  const canvas = document.createElement('canvas');
  canvas.width = rect.sw;
  canvas.height = rect.sh;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) throw new Error('display_canvas_unavailable');
  ctx.imageSmoothingEnabled = false;

  let stopped = false;
  let raf = 0;
  let frameCallback = 0;
  const requestFrame = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  }).requestVideoFrameCallback?.bind(video);
  const cancelFrame = (video as HTMLVideoElement & {
    cancelVideoFrameCallback?: (handle: number) => void;
  }).cancelVideoFrameCallback?.bind(video);

  const tick = () => {
    if (stopped) return;
    drawCrop(ctx, video, rect);
    if (requestFrame) frameCallback = requestFrame(tick);
    else raf = requestAnimationFrame(tick);
  };
  tick();

  const stream = canvas.captureStream(sourceFrameRate(sourceStream));
  for (const audioTrack of sourceStream.getAudioTracks()) {
    stream.addTrack(audioTrack.clone());
  }
  return {
    stream,
    cleanup: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (cancelFrame && frameCallback) cancelFrame(frameCallback);
      stream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
    },
  };
}

export async function startDisplayCaptureRecorder(
  recordingId: string,
  source: RecordingSourceConfig,
  sourceStream: MediaStream,
): Promise<DisplayCaptureHandle> {
  const db = getClientDb();
  const selectedArea = source.kind === 'selected_area'
    ? await createSelectedAreaStream(sourceStream, source)
    : null;
  const recordedStream = selectedArea?.stream ?? sourceStream;
  const recorder = new MediaRecorder(recordedStream, {
    mimeType: mimeType(),
    videoBitsPerSecond: bitrateFor(recordedStream, source.kind),
  });
  let chunkIndex = 0;
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      void db.screenChunks.add({ recordingId, index: chunkIndex++, blob: event.data });
    }
  };
  recorder.start(1000);

  return {
    sourceStream,
    recordedStream,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: async () => {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve();
      });
      selectedArea?.cleanup();
      sourceStream.getTracks().forEach((track) => track.stop());
    },
  };
}
