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
  /**
   * 返回给定时间点附近的显示源帧。
   * WebCodecs 路径按时间顺序解码，不逐帧 seek，避免桌面录制导出时闪烁。
   */
  getFrameAt: (timeMs: number) => Promise<FrameImage | null>;
  close: () => void;
}

function htmlVideoFrameSource(blob: Blob): DisplayFrameSource {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  let loadedWidth = 0;
  let loadedHeight = 0;
  const ready = new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => {
      loadedWidth = video.videoWidth;
      loadedHeight = video.videoHeight;
      resolve();
    };
    video.onerror = () => reject(new Error('display_video_load_failed'));
  });

  return {
    get width() { return loadedWidth || video.videoWidth || 1920; },
    get height() { return loadedHeight || video.videoHeight || 1080; },
    getFrameAt: async (timeMs: number) => {
      await ready;
      const sec = Math.max(0, timeMs / 1000);
      if (Math.abs(video.currentTime - sec) >= 0.035) {
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error('display_video_seek_failed'));
          video.currentTime = sec;
        });
      }
      return video as FrameImage;
    },
    close: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

export async function createDisplayFrameSource(blob: Blob): Promise<DisplayFrameSource> {
  try {
    const decoded = await createCameraFrameSource(blob);
    return {
      width: decoded.width,
      height: decoded.height,
      getFrameAt: async (timeMs: number) => (await decoded.getFrameAt(timeMs)) as FrameImage | null,
      close: () => decoded.close(),
    };
  } catch {
    return htmlVideoFrameSource(blob);
  }
}
