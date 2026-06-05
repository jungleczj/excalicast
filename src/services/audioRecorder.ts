'use client';

import { getClientDb } from '@/lib/db-client';

export interface AudioRecorderHandle {
  /** 麦克风 MediaStream —— 给上层做软静音（track.enabled toggle）用。 */
  stream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  getMimeType: () => string;
}

/** 语音场景标准麦克风约束（16kHz 单声道 + 回声/降噪）。 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: 16000,
    channelCount: 1,
  },
};

/** 预先获取麦克风流（取景阶段用，供后续 startAudioRecorder 复用）。失败返回 null。 */
export async function acquireMicStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch {
    return null;
  }
}

export async function startAudioRecorder(
  recordingId: string,
  existingStream?: MediaStream | null,
): Promise<AudioRecorderHandle | null> {
  // 复用取景阶段已采集的流，避免在倒计时后才申请权限/唤醒设备
  const stream = existingStream ?? (await acquireMicStream());
  if (!stream) return null;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });

  let chunkIndex = 0;
  const db = getClientDb();
  recorder.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0) {
      await db.audioChunks.add({
        recordingId,
        index: chunkIndex++,
        blob: e.data,
      });
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
    pause() {
      if (recorder.state === 'recording') recorder.pause();
    },
    resume() {
      if (recorder.state === 'paused') recorder.resume();
    },
    getMimeType() {
      return mimeType;
    },
  };
}
