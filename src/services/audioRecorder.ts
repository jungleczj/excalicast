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

export async function startAudioRecorder(recordingId: string): Promise<AudioRecorderHandle | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1,
      },
    });
  } catch {
    return null;
  }

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
