'use client';

import { getClientDb } from '@/lib/db-client';

export interface CameraHandle {
  /**
   * 当前持有的 stream（mute 期间为 null，硬件已释放）。每次访问拿最新值，
   * 上层 React 在 mute/unmute 后用它重新绑定 `<video srcObject>`。
   */
  readonly stream: MediaStream | null;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /**
   * 硬关 / 重开摄像头：
   *  - muted=true：停 MediaRecorder + track.stop() —— LED 立即灭，硬件释放。
   *  - muted=false：重新 getUserMedia + 新建 MediaRecorder，继续累加 chunkIndex。
   *
   * 失败抛错由调用方决定如何处理（一般是吞掉，UI 显示气泡保持关闭状态）。
   */
  setMuted: (muted: boolean) => Promise<void>;
  getMimeType: () => string;
}

function pickMimeType(): string {
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';
}

/**
 * 启动摄像头：拿到 stream 用于实时预览（绑到 <video>），同时录制为 webm 写入 IndexedDB cameraChunks 表。
 * 初次失败抛错（区别于 audioRecorder 的 silent fail），由调用方决定如何降级。
 *
 * 重要：返回的 handle 支持 setMuted —— mute 时真正释放硬件（LED 灭），unmute
 * 时重新 acquire 并继续录制（chunkIndex 单调累加，导出会按 index 正确串接所有
 * 分段；中间断开的时间段无视频，配合 cameraPositions 表的 hidden 事件，导出/
 * 回放管线已知如何跳过气泡）。
 */
/** 人头气泡摄像头约束：360p + 24fps（配合 VP9 + 300kbps 显著降存储）。 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 24 }, facingMode: 'user' },
  audio: false, // 音频独立采集，避免双流
};

/** 预先获取摄像头流（取景预览用，供 startCameraRecorder 复用）。 */
export async function acquireCameraStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
}

export async function startCameraRecorder(
  recordingId: string,
  existingStream?: MediaStream | null,
): Promise<CameraHandle> {
  const db = getClientDb();
  const mimeType = pickMimeType();
  let chunkIndex = 0;
  let currentStream: MediaStream | null = null;
  let currentRecorder: MediaRecorder | null = null;
  let stoppedPromise: Promise<void> = Promise.resolve();
  // 首次 acquire 复用取景预览流；之后（mute→unmute）仍 fresh 获取
  let pendingInitial: MediaStream | null = existingStream ?? null;

  const acquire = async (): Promise<void> => {
    const stream = pendingInitial ?? (await acquireCameraStream());
    pendingInitial = null;
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 300_000 });
    recorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        await db.cameraChunks.add({ recordingId, index: chunkIndex++, blob: e.data });
      }
    };
    stoppedPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start(1000);
    currentStream = stream;
    currentRecorder = recorder;
  };

  const release = async (): Promise<void> => {
    const recorder = currentRecorder;
    const stream = currentStream;
    currentRecorder = null;
    currentStream = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
      try { await stoppedPromise; } catch { /* ignore */ }
    }
    if (stream) {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    }
  };

  await acquire();

  return {
    get stream() { return currentStream; },
    async stop() {
      await release();
    },
    pause() {
      if (currentRecorder?.state === 'recording') currentRecorder.pause();
    },
    resume() {
      if (currentRecorder?.state === 'paused') currentRecorder.resume();
    },
    async setMuted(muted: boolean) {
      if (muted) {
        if (currentStream || currentRecorder) await release();
      } else {
        if (!currentStream) await acquire();
      }
    },
    getMimeType() { return mimeType; },
  };
}
