'use client';

import { getClientDb } from '@/lib/db-client';

export interface CameraHandle {
  stream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  getMimeType: () => string;
}

/**
 * 启动摄像头：拿到 stream 用于实时预览（绑到 <video>），同时录制为 webm 写入 IndexedDB cameraChunks 表。
 * 失败抛错（区别于 audioRecorder 的 silent fail），由调用方决定如何降级。
 */
export async function startCameraRecorder(recordingId: string): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false, // 音频独立采集，避免双流
  });

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
  let chunkIndex = 0;
  const db = getClientDb();
  recorder.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0) {
      await db.cameraChunks.add({ recordingId, index: chunkIndex++, blob: e.data });
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(1000);

  return {
    stream,
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
    },
    pause() { if (recorder.state === 'recording') recorder.pause(); },
    resume() { if (recorder.state === 'paused') recorder.resume(); },
    getMimeType() { return mimeType; },
  };
}
