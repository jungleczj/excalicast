'use client';

import { getClientDb } from '@/lib/db-client';
import { ChunkWriteBatcher } from '@/services/mediaRecorderHealth';
import { stopMediaRecorderSafely } from '@/services/mediaRecorderStop';
import type { AudioSourceInfo } from '@/types/recording';

const RECORDER_TIMESLICE_MS = 250;
export const AUDIO_RECORDING_BITS_PER_SECOND = 128_000;

export interface AudioRecorderHandle {
  /** 麦克风 MediaStream —— 给上层做软静音（track.enabled toggle）用。 */
  stream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  getMimeType: () => string;
  sourceInfo: AudioSourceInfo;
}

/** 语音场景标准麦克风约束（48kHz 单声道 + 回声/降噪）。 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: { ideal: 48_000 },
    channelCount: { ideal: 1 },
  },
};

const FALLBACK_MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: { ideal: 1 },
  },
};

export function buildAudioSourceInfo(
  settings: MediaTrackSettings,
  mimeType: string,
  bitsPerSecond = AUDIO_RECORDING_BITS_PER_SECOND,
): AudioSourceInfo {
  return {
    ...(typeof settings.sampleRate === 'number' ? { sampleRate: settings.sampleRate } : {}),
    ...(typeof settings.channelCount === 'number' ? { channelCount: settings.channelCount } : {}),
    mimeType,
    bitsPerSecond,
  };
}

/** 预先获取麦克风流（取景阶段用，供后续 startAudioRecorder 复用）。失败返回 null。 */
export async function acquireMicStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    const errorName = error instanceof DOMException ? error.name : '';
    if (errorName !== 'OverconstrainedError' && !(error instanceof TypeError)) return null;
    try {
      return await navigator.mediaDevices.getUserMedia(FALLBACK_MIC_CONSTRAINTS);
    } catch {
      return null;
    }
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
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_RECORDING_BITS_PER_SECOND });
  const sourceInfo = buildAudioSourceInfo(
    stream.getAudioTracks()[0]?.getSettings?.() ?? {},
    recorder.mimeType || mimeType,
    recorder.audioBitsPerSecond || AUDIO_RECORDING_BITS_PER_SECOND,
  );

  let chunkIndex = 0;
  let stopping = false;
  let endedUnexpectedly = false;
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (!stopping) endedUnexpectedly = true;
    });
  }
  const db = getClientDb();
  const chunkWriter = new ChunkWriteBatcher<{ recordingId: string; index: number; blob: Blob }>({
    writeBatch: (items) => db.audioChunks.bulkAdd(items),
    sizeOf: (item) => item.blob.size,
  });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunkWriter.enqueue({
        recordingId,
        index: chunkIndex++,
        blob: e.data,
      });
    }
  };

  recorder.start(RECORDER_TIMESLICE_MS);

  return {
    stream,
    sourceInfo,
    async stop() {
      stopping = true;
      await stopMediaRecorderSafely(recorder);
      stream.getTracks().forEach((t) => t.stop());
      try { await chunkWriter.flush(); }
      catch { throw new Error('audio_chunk_write_failed'); }
      if (endedUnexpectedly) throw new Error('audio_track_ended');
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
