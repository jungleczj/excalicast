'use client';

import { v4 as uuidv4 } from 'uuid';
import {
  appendScreenChunk,
  getClientDb,
  getScreenRecording,
  putScreenRecording,
  updateScreenRecording,
} from '@/lib/db-client';
import { captureCamera, captureDisplay, captureMicrophone } from '@/services/displayCapture';
import { startLiveComposite, type CompositeOutput } from '@/services/liveComposite';
import type { ScreenRecordingMetadata } from '@/types/recording';

const LOG_TAG = '[screenRecording v4]';

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
  /** Permission failures we caught — UI can surface these to the user. */
  micError?: string;
  cameraError?: string;
  /** Which surface the user picked in getDisplayMedia. UI uses this to decide
   *  whether showing a DOM camera preview is safe (recording 'browser' surface
   *  risks bubble recursion when the user picked our own tab). */
  displaySurface: 'monitor' | 'window' | 'browser' | 'unknown';
  /** for live preview UI */
  cameraStream: MediaStream | null;
  setCameraPosition: (pos: { x: number; y: number }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<ScreenRecordingMetadata>;
  getElapsedMs: () => number;
}

const CHUNK_INTERVAL_MS = 1000;

/**
 * Pick the MediaRecorder mime based on what's ACTUALLY in the stream.
 * If the user denied mic permission, our output stream has no audio track —
 * declaring `opus` in the mime then makes Chrome stall the encoder and emit
 * empty chunks. So we conditionally include opus only when audio is present.
 *
 * VP8 is listed before VP9 deliberately. VP8 encodes much faster than VP9 in
 * software (Chrome's MediaRecorder VP9 path) and is more reliable at high
 * resolutions like 2940×1702 (Retina screen capture).
 */
function pickRecorderMime(stream: MediaStream): string {
  const hasAudio = stream.getAudioTracks().length > 0;
  const candidates = hasAudio
    ? [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
      ]
    : [
        'video/webm;codecs=vp8',
        'video/webm;codecs=vp9',
        'video/webm;codecs=h264',
        'video/webm',
      ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

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
  let micError: string | undefined;
  if (opts.withMic) {
    try {
      micStream = await captureMicrophone();
      hasMic = true;
    } catch (err) {
      micError = err instanceof Error ? err.message : 'unknown';
      console.warn(LOG_TAG, 'mic_failed:', micError);
    }
  }

  // 3) Camera — graceful degrade
  let cameraStream: MediaStream | null = null;
  let hasCamera = false;
  let cameraError: string | undefined;
  if (opts.withCamera) {
    try {
      cameraStream = await captureCamera();
      hasCamera = true;
    } catch (err) {
      cameraError = err instanceof Error ? err.message : 'unknown';
      console.warn(LOG_TAG, 'camera_failed:', cameraError);
    }
  }
  console.info(LOG_TAG, 'start:', {
    recordingId,
    withMic: opts.withMic, hasMic, micError,
    withSystemAudio: opts.withSystemAudio, hasSystemAudio,
    withCamera: opts.withCamera, hasCamera, cameraError,
  });

  // 4) Composite — async because we await displayVideo metadata so we can
  // size the canvas to the real capture dimensions.
  const composite: CompositeOutput = await startLiveComposite(
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

  // 6) MediaRecorder — pick mime based on actual stream tracks so we don't
  // declare opus when there's no audio (Chrome stalls the encoder otherwise).
  const mimeType = pickRecorderMime(composite.outputStream);
  const hasOutputAudio = composite.outputStream.getAudioTracks().length > 0;
  // Don't pin a bitrate — at Retina resolutions (2940×1702) our previous
  // 6 Mbps was too tight and the VP9 encoder produced empty chunks. Letting
  // Chrome pick its default works for all resolutions.
  const recorderOpts: MediaRecorderOptions = { mimeType };
  if (hasOutputAudio) recorderOpts.audioBitsPerSecond = 128_000;
  console.info(LOG_TAG, 'creating MediaRecorder with', recorderOpts,
    'video tracks:', composite.outputStream.getVideoTracks().length,
    'audio tracks:', composite.outputStream.getAudioTracks().length);
  const recorder = new MediaRecorder(composite.outputStream, recorderOpts);

  let chunkIndex = 0;
  let droppedEmpty = 0;
  // Track in-flight chunk writes so stopInternal can wait for the final
  // ondataavailable burst to fully land in IndexedDB before we navigate to
  // /process/[id]. Without this we get races where loadScreenRecordingWebm
  // throws "no_chunks_for_<id>" because the final chunk write hadn't completed.
  const pendingChunkWrites = new Set<Promise<unknown>>();
  recorder.ondataavailable = (e: BlobEvent) => {
    if (!e.data || e.data.size === 0) {
      droppedEmpty++;
      console.warn(LOG_TAG, 'empty chunk dropped (total:', droppedEmpty, ')');
      return;
    }
    const idx = chunkIndex++;
    const p = appendScreenChunk({
      recordingId,
      index: idx,
      blob: e.data,
    }).then(
      () => { console.debug(LOG_TAG, 'chunk', idx, 'persisted', e.data.size, 'bytes'); },
      (err) => { console.error(LOG_TAG, 'chunk', idx, 'WRITE FAILED:', err); throw err; },
    );
    pendingChunkWrites.add(p);
    void p.finally(() => pendingChunkWrites.delete(p));
  };
  recorder.onerror = (e: Event) => {
    console.error(LOG_TAG, 'MediaRecorder error:', e);
  };

  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;
  recorder.start(CHUNK_INTERVAL_MS);
  console.info(LOG_TAG, 'MediaRecorder started, mime=', mimeType, 'state=', recorder.state);

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  const stopInternal = async (): Promise<ScreenRecordingMetadata> => {
    if (paused) {
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    }
    console.info(LOG_TAG, 'stop: requestData + recorder.stop()');
    // requestData flushes the current buffer to ondataavailable BEFORE we stop,
    // so we get one final chunk regardless of where in the timeslice cycle we are.
    try { recorder.requestData(); } catch { /* recorder may have ended early */ }
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') return resolve();
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    console.info(LOG_TAG, 'recorder onstop fired. pending writes:', pendingChunkWrites.size);

    // Wait for ALL outstanding chunk writes (including any final ondataavailable
    // that fires AFTER onstop in some browsers).
    if (pendingChunkWrites.size > 0) {
      await Promise.allSettled([...pendingChunkWrites]);
    }

    // Defensive: poll the actual chunk count for up to 5s, in case a final
    // ondataavailable hasn't been delivered to the JS event loop yet.
    const db = getClientDb();
    const deadline = Date.now() + 5000;
    let chunkCount = 0;
    while (Date.now() < deadline) {
      chunkCount = await db.screenChunks.where('recordingId').equals(recordingId).count();
      if (chunkCount > 0) break;
      // Drain any newly arrived writes
      if (pendingChunkWrites.size > 0) {
        await Promise.allSettled([...pendingChunkWrites]);
        continue;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    console.info(LOG_TAG, 'final chunk count in IndexedDB:', chunkCount, 'droppedEmpty:', droppedEmpty);

    composite.stop();

    if (chunkCount === 0) {
      // Clean up the orphan metadata row so the library doesn't show a 0-byte item
      try { await db.screenRecordings.delete(recordingId); } catch { /* */ }
      throw new Error(
        `no_data_captured: 录制未产生任何视频数据（dropped=${droppedEmpty}）。\n` +
        '常见原因：浏览器在 getDisplayMedia 后没拿到帧（macOS 屏幕录制权限被拒？显示器进入睡眠？）。\n' +
        '建议：检查浏览器是否有「屏幕录制」权限，并确保录制中屏幕不进入睡眠。',
      );
    }

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

  // Detect which surface the user picked, so the UI can decide whether
  // showing a DOM camera preview would cause bubble-recursion. 'browser' =
  // a tab (possibly OURS), 'window' = an app window, 'monitor' = the entire
  // display. Recursion is only possible when 'browser' AND it's our own tab,
  // but we can't tell THAT from outside, so any 'browser' value is treated
  // as risky.
  const displaySurface: 'monitor' | 'window' | 'browser' | 'unknown' = (() => {
    const s = (displayStream.getVideoTracks()[0]?.getSettings() ?? {}) as {
      displaySurface?: string;
    };
    if (s.displaySurface === 'monitor' || s.displaySurface === 'window' || s.displaySurface === 'browser') {
      return s.displaySurface;
    }
    return 'unknown';
  })();
  console.info(LOG_TAG, 'displaySurface =', displaySurface);

  return {
    recordingId,
    startedAt,
    output: composite.output,
    hasMic,
    hasSystemAudio,
    hasCamera,
    micError,
    cameraError,
    displaySurface,
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
