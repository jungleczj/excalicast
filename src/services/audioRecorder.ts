'use client';

import { getClientDb } from '@/lib/db-client';

export interface AudioRecorderHandle {
  stop: () => Promise<void>;
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
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
    },
    getMimeType() {
      return mimeType;
    },
  };
}
