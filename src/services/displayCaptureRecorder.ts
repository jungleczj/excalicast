'use client';

import { getClientDb } from '@/lib/db-client';
import { ChunkWriteBatcher, type ChunkWriteMetrics } from '@/services/mediaRecorderHealth';
import { stopMediaRecorderSafely } from '@/services/mediaRecorderStop';
import { captureProfileFor, fallbackCaptureProfile } from '@/services/recordingCapturePolicy';
import type { RecordingSourceConfig, RecordingSourceKind } from '@/types/recording';

const RECORDER_TIMESLICE_MS = 1_000;

export interface DisplayCaptureHandle {
  sourceStream: MediaStream;
  recordedStream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  diagnostics: () => ChunkWriteMetrics;
}

function mimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
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

function videoTrackSettings(stream: MediaStream): MediaTrackSettings {
  return stream.getVideoTracks()[0]?.getSettings?.() ?? {};
}

function sourcePixelSize(stream: MediaStream): { width: number; height: number } {
  const settings = videoTrackSettings(stream);
  return {
    width: even(typeof settings.width === 'number' && settings.width > 0 ? settings.width : 1920),
    height: even(typeof settings.height === 'number' && settings.height > 0 ? settings.height : 1080),
  };
}

/**
 * 某些浏览器/虚拟显示流会在 `play()` 成功后延迟（甚至不触发）metadata 事件。
 * 选区录制不应因此永远停在倒计时结束：已有 track settings 时，它们就是可靠的
 * 像素后备值；等首帧到来后 canvas 会自然开始绘制。
 */
async function waitForVideoDimensions(
  video: HTMLVideoElement,
  fallback: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  // 虚拟捕获源可能永远不 resolve play()；绝不能让倒计时结束后卡在这里。
  await Promise.race([
    video.play().catch(() => {}),
    new Promise<void>((resolve) => window.setTimeout(resolve, 800)),
  ]);
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('loadeddata', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done, { once: true });
    video.addEventListener('loadeddata', done, { once: true });
    window.setTimeout(done, 800);
  });
  return {
    width: video.videoWidth || fallback.width,
    height: video.videoHeight || fallback.height,
  };
}

function bitrateFor(stream: MediaStream, kind: RecordingSourceKind): number {
  const { width, height } = sourcePixelSize(stream);
  void kind;
  return fallbackCaptureProfile({ width, height }).videoBitsPerSecond;
}

export async function acquireDisplayStream(source: RecordingSourceConfig): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('display_capture_not_supported');
  }
  const video: DisplayVideoConstraints = {
    width: { ideal: 2560, max: 2560 },
    height: { ideal: 1440, max: 1440 },
    frameRate: { ideal: 30, max: 30 },
    cursor: 'always',
    resizeMode: 'none',
    logicalSurface: true,
    ...(source.displaySurface ? { displaySurface: source.displaySurface } : {}),
  };
  // 桌面 / 窗口录制不需要捕获本页；让浏览器从系统选择器开始就排除当前 tab，
  // 且不允许录制中切换回当前 tab，避免用户无意中形成递归的“屏幕录屏幕”。
  // 当前标签页是唯一有意录制本页的模式，保留该模式原本的行为。
  const mayCaptureCurrentTab = source.kind === 'current_tab';
  const options: DisplayMediaOptions = {
    video,
    audio: source.captureSystemAudio ? true : false,
    ...(mayCaptureCurrentTab ? { preferCurrentTab: true } : {}),
    selfBrowserSurface: mayCaptureCurrentTab ? 'include' : 'exclude',
    surfaceSwitching: mayCaptureCurrentTab ? 'include' : 'exclude',
    systemAudio: source.captureSystemAudio ? 'include' : 'exclude',
    windowAudio: source.captureSystemAudio ? 'system' : 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.contentHint = 'text';
    const settings = track.getSettings();
    const profile = captureProfileFor({
      width: settings.width ?? 1920,
      height: settings.height ?? 1080,
      frameRate: settings.frameRate,
    }, 'adaptive');
    await track.applyConstraints({
      width: { max: profile.width },
      height: { max: profile.height },
      frameRate: { max: profile.frameRate },
    }).catch(() => undefined);
  }
  return stream;
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
  try {
    const dimensions = await waitForVideoDimensions(video, sourcePixelSize(stream));
    return {
      width: even(dimensions.width),
      height: even(dimensions.height),
      frameRate: settings.frameRate ? Math.round(settings.frameRate) : undefined,
    };
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

export async function prepareDisplayRecordingStream(
  sourceStream: MediaStream,
  _source: RecordingSourceConfig,
  _document: Pick<Document, 'createElement'> | undefined = typeof document === 'undefined' ? undefined : document,
): Promise<{ stream: MediaStream; cleanup?: () => void }> {
  // Cropping is intentionally deferred to preview/export. A live video->canvas->captureStream
  // pass copies every source pixel through the main thread and is the dominant selected-area
  // recording cost on high-DPI displays.
  return { stream: sourceStream };
}

export async function startDisplayCaptureRecorder(
  recordingId: string,
  source: RecordingSourceConfig,
  sourceStream: MediaStream,
): Promise<DisplayCaptureHandle> {
  // Keep the worker-only module out of SSR/test module evaluation: it contains
  // an import.meta URL resolved by the browser bundler.
  const { startWebCodecsDisplayRecorder } = await import('@/services/webCodecsDisplayRecorder');
  const fastPath = await startWebCodecsDisplayRecorder(recordingId, source, sourceStream);
  if (fastPath) return fastPath;
  const db = getClientDb();
  const prepared = await prepareDisplayRecordingStream(sourceStream, source);
  // System audio is persisted by its own recorder. Keeping this stream video-only
  // prevents duplicate audio writes and makes preview/export track selection explicit.
  const recordedStream = new MediaStream(prepared.stream.getVideoTracks());
  const recorder = new MediaRecorder(recordedStream, {
    mimeType: mimeType(),
    videoBitsPerSecond: bitrateFor(recordedStream, source.kind),
  });
  let chunkIndex = 0;
  const chunkWriter = new ChunkWriteBatcher<{ recordingId: string; index: number; blob: Blob }>({
    writeBatch: (items) => db.screenChunks.bulkAdd(items),
    sizeOf: (item) => item.blob.size,
  });
  let stopping = false;
  let endedUnexpectedly = false;
  for (const track of sourceStream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (!stopping) endedUnexpectedly = true;
    });
  }
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunkWriter.enqueue({ recordingId, index: chunkIndex++, blob: event.data });
    }
  };
  recorder.start(RECORDER_TIMESLICE_MS);

  return {
    sourceStream,
    recordedStream,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: async () => {
      stopping = true;
      await stopMediaRecorderSafely(recorder);
      prepared.cleanup?.();
      sourceStream.getTracks().forEach((track) => track.stop());
      try { await chunkWriter.flush(); }
      catch { throw new Error('screen_chunk_write_failed'); }
      if (endedUnexpectedly) throw new Error('screen_track_ended');
    },
    diagnostics: () => chunkWriter.metrics(),
  };
}
