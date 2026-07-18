'use client';

export interface DisplayFrameSource {
  video: HTMLVideoElement;
  ready: Promise<void>;
  seek: (timeMs: number) => Promise<void>;
  close: () => void;
}

export function createDisplayFrameSource(blob: Blob): DisplayFrameSource {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const ready = new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('display_video_load_failed'));
  });
  return {
    video,
    ready,
    seek: async (timeMs: number) => {
      await ready;
      const sec = Math.max(0, timeMs / 1000);
      if (Math.abs(video.currentTime - sec) < 0.035) return;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('display_video_seek_failed'));
        video.currentTime = sec;
      });
    },
    close: () => URL.revokeObjectURL(url),
  };
}
