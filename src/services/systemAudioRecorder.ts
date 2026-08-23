'use client';

import { getClientDb } from '@/lib/db-client';
import { ChunkWriteBatcher, type ChunkWriteMetrics } from '@/services/mediaRecorderHealth';
import { stopMediaRecorderSafely } from '@/services/mediaRecorderStop';

const RECORDER_TIMESLICE_MS = 1_000;

export interface SystemAudioRecorderHandle {
  recordedStream: MediaStream;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  diagnostics: () => ChunkWriteMetrics;
}

function systemAudioMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  return 'audio/webm';
}

/** Records display-capture audio without taking ownership of its shared tracks. */
export async function startSystemAudioRecorder(
  recordingId: string,
  displayStream: MediaStream,
): Promise<SystemAudioRecorderHandle | null> {
  const audioTracks = displayStream.getAudioTracks();
  if (audioTracks.length === 0) return null;

  const recordedStream = new MediaStream(audioTracks);
  const recorder = new MediaRecorder(recordedStream, {
    mimeType: systemAudioMimeType(),
    audioBitsPerSecond: 192_000,
  });
  const db = getClientDb();
  let chunkIndex = 0;
  const writer = new ChunkWriteBatcher<{ recordingId: string; index: number; blob: Blob }>({
    writeBatch: (items) => db.systemAudioChunks.bulkAdd(items),
    sizeOf: (item) => item.blob.size,
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) writer.enqueue({ recordingId, index: chunkIndex++, blob: event.data });
  };
  recorder.start(RECORDER_TIMESLICE_MS);

  return {
    recordedStream,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: async () => {
      await stopMediaRecorderSafely(recorder);
      try { await writer.flush(); }
      catch { throw new Error('system_audio_chunk_write_failed'); }
    },
    diagnostics: () => writer.metrics(),
  };
}
