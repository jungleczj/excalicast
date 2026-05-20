'use client';

import { v4 as uuidv4 } from 'uuid';
import {
  appendScreenChunk,
  getScreenRecording,
  putScreenRecording,
  updateScreenRecording,
} from '@/lib/db-client';
import { captureCamera, captureDisplay, captureMicrophone } from '@/services/displayCapture';
import { startLiveComposite, type CompositeOutput } from '@/services/liveComposite';
import type { ScreenRecordingMetadata } from '@/types/recording';

export interface StartScreenRecordingOpts {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
  initialCameraPosition: { x: number; y: number };
  cameraSizePx: number;          // 160
}

export interface ScreenRecordingHandle {
  recordingId: string;
  startedAt: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  /** for live preview UI */
  cameraStream: MediaStream | null;
  setCameraPosition: (pos: { x: number; y: number }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<ScreenRecordingMetadata>;
  getElapsedMs: () => number;
}

const CHUNK_INTERVAL_MS = 1000;
const RECORDER_MIME = 'video/webm;codecs=vp9,opus';

export async function startScreenRecording(opts: StartScreenRecordingOpts): Promise<ScreenRecordingHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();

  // 1) Display
  const { videoStream: displayStream, systemAudioTrack } = await captureDisplay({
    withSystemAudio: opts.withSystemAudio,
  });
  const hasSystemAudio = systemAudioTrack !== null;

  // 2) Mic — graceful degrade
  let micStream: MediaStream | null = null;
  let hasMic = false;
  if (opts.withMic) {
    try {
      micStream = await captureMicrophone();
      hasMic = true;
    } catch (err) {
      // Mic permission denied — degrade silently. UI shows hasMic=false.
      if (process.env.NODE_ENV !== 'production') console.warn('mic_failed', err);
    }
  }

  // 3) Camera — graceful degrade
  let cameraStream: MediaStream | null = null;
  let hasCamera = false;
  if (opts.withCamera) {
    try {
      cameraStream = await captureCamera();
      hasCamera = true;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.warn('camera_failed', err);
    }
  }

  // 4) Composite
  const composite: CompositeOutput = startLiveComposite(
    {
      displayStream,
      cameraStream,
      micStream,
      systemAudioTrack,
    },
    {
      fps: 30,
      cameraSizePx: opts.cameraSizePx,
      initialCameraPosition: opts.initialCameraPosition,
    },
  );

  // 5) Persist initial metadata
  await putScreenRecording({
    id: recordingId,
    kind: 'screen_capture',
    startedAt,
    durationMs: 0,
    output: composite.output,
    hasMic,
    hasSystemAudio,
    hasCamera,
    status: 'recording',
  });

  // 6) MediaRecorder
  const recorder = new MediaRecorder(composite.outputStream, {
    mimeType: RECORDER_MIME,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  });

  let chunkIndex = 0;
  recorder.ondataavailable = async (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      await appendScreenChunk({
        recordingId,
        index: chunkIndex++,
        blob: e.data,
      });
    }
  };

  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;
  recorder.start(CHUNK_INTERVAL_MS);

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  const stopInternal = async (): Promise<ScreenRecordingMetadata> => {
    if (paused) {
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    }
    // Flush + wait for the final ondataavailable
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') return resolve();
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    composite.stop();

    const durationMs = elapsed();
    await updateScreenRecording(recordingId, { durationMs, status: 'done' });
    const final = await getScreenRecording(recordingId);
    if (!final) throw new Error('recording_lost_after_stop');
    return final;
  };

  // Auto-stop if user kills the display stream from the browser UI
  displayStream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder.state !== 'inactive') {
      void stopInternal();
    }
  });

  return {
    recordingId,
    startedAt,
    output: composite.output,
    hasMic,
    hasSystemAudio,
    hasCamera,
    cameraStream,
    setCameraPosition: composite.setCameraPosition,
    getElapsedMs: elapsed,
    pause: () => {
      if (paused) return;
      recorder.pause();
      paused = true;
      pauseStartedAt = Date.now();
    },
    resume: () => {
      if (!paused) return;
      recorder.resume();
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    },
    stop: stopInternal,
  };
}
