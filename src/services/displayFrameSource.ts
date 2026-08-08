'use client';

import { createCameraFrameSource } from './webmCameraFrames';

type FrameImage = CanvasImageSource & {
  videoWidth?: number;
  videoHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  codedWidth?: number;
  codedHeight?: number;
};

export interface DisplayFrameSource {
  width: number;
  height: number;
  decoderPath: 'mediabunny-stream' | 'legacy-array-buffer' | 'html-video';
  /**
   * 返回给定时间点附近的显示源帧。
   * WebCodecs 路径按时间顺序解码，不逐帧 seek，避免桌面录制导出时闪烁。
   */
  getFrameAt: (timeMs: number) => Promise<FrameImage | null>;
  setPlayback?: (playing: boolean, timeMs: number) => Promise<void>;
  getDecodedFrameCount?: () => number;
  close: () => void;
}

export type DisplaySourceStage = 'decoder_init' | 'metadata' | 'seek' | 'playback';

export class DisplaySourceStageError extends Error {
  readonly name = 'DisplaySourceStageError';

  constructor(
    public readonly stage: DisplaySourceStage,
    public readonly code: 'timeout' | 'failed',
    options?: { cause?: unknown },
  ) {
    super(`display_source_${code}:${stage}`, options);
  }
}

export function waitForDisplaySourceStage<T>(
  stage: DisplaySourceStage,
  promise: Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 8_000);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const abort = () => finish(() => reject(new DOMException('Display source operation aborted', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(new DisplaySourceStageError(stage, 'timeout'))), timeoutMs);
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error instanceof DisplaySourceStageError
        ? error
        : new DisplaySourceStageError(stage, 'failed', { cause: error }))),
    );
  });
}

interface DisplayFrameSourceOptions {
  signal?: AbortSignal;
  decoderTimeoutMs?: number;
  metadataTimeoutMs?: number;
  seekTimeoutMs?: number;
}

export function createSeekableDisplayFrameSource(
  blob: Blob,
  options: DisplayFrameSourceOptions = {},
): DisplayFrameSource {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  let loadedWidth = 0;
  let loadedHeight = 0;
  let decodedFrameCount = 0;
  let closed = false;
  const metadataReady = new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => {
      loadedWidth = video.videoWidth;
      loadedHeight = video.videoHeight;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve();
    };
    video.onloadeddata = () => {
      loadedWidth = video.videoWidth;
      loadedHeight = video.videoHeight;
      resolve();
    };
    video.onerror = () => reject(new Error('display_video_load_failed'));
  });
  const ready = waitForDisplaySourceStage('metadata', metadataReady, {
    timeoutMs: options.metadataTimeoutMs,
    signal: options.signal,
  });
  const seekTo = async (sec: number) => {
    if (closed) throw new DOMException('Display source closed', 'AbortError');
    if (Math.abs(video.currentTime - sec) < 0.035) return;
    const seeked = new Promise<void>((resolve, reject) => {
      const done = () => requestAnimationFrame(() => resolve());
      const failed = () => reject(new Error('display_video_seek_failed'));
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.currentTime = sec;
    });
    await waitForDisplaySourceStage('seek', seeked, {
      timeoutMs: options.seekTimeoutMs,
      signal: options.signal,
    });
    decodedFrameCount += 1;
  };

  return {
    get width() { return loadedWidth || video.videoWidth || 1920; },
    get height() { return loadedHeight || video.videoHeight || 1080; },
    decoderPath: 'html-video',
    setPlayback: async (playing, timeMs) => {
      await ready;
      if (!playing) {
        video.pause();
        return;
      }
      await seekTo(Math.max(0, timeMs / 1000));
      await waitForDisplaySourceStage('playback', video.play(), {
        timeoutMs: options.seekTimeoutMs,
        signal: options.signal,
      });
    },
    getFrameAt: async (timeMs: number) => {
      await ready;
      const sec = Math.max(0, timeMs / 1000);
      // 连续播放由媒体时钟推进，不做逐帧 seek。只有暂停 scrub、跨裁剪段或
      // 时钟漂移明显时才重新定位。
      if (video.paused || Math.abs(video.currentTime - sec) > 0.35) await seekTo(sec);
      return video as FrameImage;
    },
    getDecodedFrameCount: () => decodedFrameCount,
    close: () => {
      if (closed) return;
      closed = true;
      video.pause();
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

export async function createDisplayFrameSource(
  blob: Blob,
  options: DisplayFrameSourceOptions = {},
): Promise<DisplayFrameSource> {
  const decoder = createCameraFrameSource(blob);
  try {
    const decoded = await waitForDisplaySourceStage('decoder_init', decoder, {
      timeoutMs: options.decoderTimeoutMs ?? 12_000,
      signal: options.signal,
    });
    return {
      width: decoded.width,
      height: decoded.height,
      decoderPath: decoded.decoderPath,
      getFrameAt: async (timeMs: number) => (await decoded.getFrameAt(timeMs)) as FrameImage | null,
      getDecodedFrameCount: () => decoded.getDecodedFrameCount(),
      close: () => decoded.close(),
    };
  } catch (error) {
    void decoder.then((source) => source.close()).catch(() => undefined);
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return createSeekableDisplayFrameSource(blob, options);
  }
}
