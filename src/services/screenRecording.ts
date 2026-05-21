'use client';

import { v4 as uuidv4 } from 'uuid';
import {
  appendScreenCameraChunk,
  appendScreenChunk,
  getClientDb,
  getScreenRecording,
  putScreenRecording,
  updateScreenRecording,
} from '@/lib/db-client';
import { captureCamera, captureDisplay, captureMicrophone } from '@/services/displayCapture';
import { startLiveComposite, type CompositeOutput } from '@/services/liveComposite';
import { openCameraPreview, type PipHandle } from '@/services/cameraPreviewPip';
import type {
  BubbleSource,
  DisplaySurface,
  ScreenRecordingMetadata,
} from '@/types/recording';

const LOG_TAG = '[screenRecording v5]';

export interface StartScreenRecordingOpts {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
}

export interface ScreenRecordingHandle {
  recordingId: string;
  startedAt: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  micError?: string;
  cameraError?: string;
  displaySurface: DisplaySurface;
  bubbleSource: BubbleSource;
  /** Whether we successfully opened a Picture-in-Picture preview for the camera.
   *  When false + hasCamera, user has no live preview but recording still works. */
  previewActive: boolean;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<ScreenRecordingMetadata>;
  getElapsedMs: () => number;
}

const CHUNK_INTERVAL_MS = 1000;

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

function detectDisplaySurface(stream: MediaStream): DisplaySurface {
  const s = (stream.getVideoTracks()[0]?.getSettings() ?? {}) as { displaySurface?: string };
  if (s.displaySurface === 'monitor' || s.displaySurface === 'window' || s.displaySurface === 'browser') {
    return s.displaySurface;
  }
  return 'unknown';
}

export async function startScreenRecording(opts: StartScreenRecordingOpts): Promise<ScreenRecordingHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();

  // 1) Display capture (synchronous user-gesture window)
  const { videoStream: displayStream, systemAudioTrack } = await captureDisplay({
    withSystemAudio: opts.withSystemAudio,
  });
  const hasSystemAudio = systemAudioTrack !== null;
  const displaySurface = detectDisplaySurface(displayStream);

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

  // 4) PiP preview — only if we actually have a camera stream.
  let pipHandle: PipHandle | null = null;
  if (cameraStream) {
    try {
      pipHandle = await openCameraPreview(cameraStream);
    } catch (err) {
      console.warn(LOG_TAG, 'PiP attempt threw:', err);
      pipHandle = null;
    }
  }
  const previewActive = !!pipHandle;

  // 5) Decide bubbleSource based on what we know:
  //    - no camera → 'none'
  //    - 'monitor' AND PiP succeeded → 'in_screen' (PiP is on the recorded screen)
  //    - otherwise (browser/window with PiP, or any surface without PiP) → 'overlay'
  //      (we'll record camera.webm separately and ffmpeg overlay at export)
  const bubbleSource: BubbleSource =
    !hasCamera
      ? 'none'
      : (displaySurface === 'monitor' && previewActive)
        ? 'in_screen'
        : 'overlay';

  console.info(LOG_TAG, 'start:', {
    recordingId,
    withMic: opts.withMic, hasMic, micError,
    withSystemAudio: opts.withSystemAudio, hasSystemAudio,
    withCamera: opts.withCamera, hasCamera, cameraError,
    displaySurface, previewActive, bubbleSource,
  });

  // 6) Screen composite (no camera path inside) + screen MediaRecorder
  const composite: CompositeOutput = await startLiveComposite(
    { displayStream, micStream, systemAudioTrack },
    { fps: 30 },
  );

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
    displaySurface,
    bubbleSource,
    cameraOverlayPosition: 'bottom-right',
  });

  const screenMime = pickRecorderMime(composite.outputStream);
  const screenHasAudio = composite.outputStream.getAudioTracks().length > 0;
  const screenOpts: MediaRecorderOptions = { mimeType: screenMime };
  if (screenHasAudio) screenOpts.audioBitsPerSecond = 128_000;
  const screenRecorder = new MediaRecorder(composite.outputStream, screenOpts);
  console.info(LOG_TAG, 'screen recorder mime:', screenMime, 'audio tracks:', composite.outputStream.getAudioTracks().length);

  // 7) Camera MediaRecorder — only if bubbleSource === 'overlay' (we need camera.webm
  //    for ffmpeg overlay at export). For 'in_screen' or 'none' we don't need it.
  let cameraRecorder: MediaRecorder | null = null;
  if (bubbleSource === 'overlay' && cameraStream) {
    const camMime = pickRecorderMime(cameraStream);
    cameraRecorder = new MediaRecorder(cameraStream, { mimeType: camMime });
    console.info(LOG_TAG, 'camera recorder mime:', camMime);
  }

  // 8) Chunk write tracking — both recorders share a single pending-writes set
  let screenIdx = 0;
  let cameraIdx = 0;
  let droppedEmpty = 0;
  const pendingChunkWrites = new Set<Promise<unknown>>();

  screenRecorder.ondataavailable = (e: BlobEvent): void => {
    if (!e.data || e.data.size === 0) {
      droppedEmpty++;
      console.warn(LOG_TAG, 'screen empty chunk dropped (total:', droppedEmpty, ')');
      return;
    }
    const idx = screenIdx++;
    const p = appendScreenChunk({ recordingId, index: idx, blob: e.data })
      .catch((err) => { console.error(LOG_TAG, 'screen chunk', idx, 'WRITE FAILED:', err); throw err; });
    pendingChunkWrites.add(p);
    void p.finally(() => pendingChunkWrites.delete(p));
  };
  screenRecorder.onerror = (e: Event) => {
    console.error(LOG_TAG, 'screen MediaRecorder error:', e);
  };

  if (cameraRecorder) {
    cameraRecorder.ondataavailable = (e: BlobEvent): void => {
      if (!e.data || e.data.size === 0) return;
      const idx = cameraIdx++;
      const p = appendScreenCameraChunk({ recordingId, index: idx, blob: e.data })
        .catch((err) => { console.error(LOG_TAG, 'camera chunk', idx, 'WRITE FAILED:', err); throw err; });
      pendingChunkWrites.add(p);
      void p.finally(() => pendingChunkWrites.delete(p));
    };
    cameraRecorder.onerror = (e: Event) => {
      console.error(LOG_TAG, 'camera MediaRecorder error:', e);
    };
  }

  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;

  screenRecorder.start(CHUNK_INTERVAL_MS);
  cameraRecorder?.start(CHUNK_INTERVAL_MS);
  console.info(LOG_TAG, 'recorders started');

  const elapsed = (): number => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  const stopInternal = async (): Promise<ScreenRecordingMetadata> => {
    if (paused) {
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    }
    console.info(LOG_TAG, 'stopping: requestData + stop on both recorders');

    // Flush both recorders' active buffers.
    try { screenRecorder.requestData(); } catch { /* */ }
    try { cameraRecorder?.requestData(); } catch { /* */ }

    const waitStop = (rec: MediaRecorder): Promise<void> => new Promise((resolve) => {
      if (rec.state === 'inactive') return resolve();
      rec.onstop = () => resolve();
      rec.stop();
    });
    await Promise.all([
      waitStop(screenRecorder),
      cameraRecorder ? waitStop(cameraRecorder) : Promise.resolve(),
    ]);
    console.info(LOG_TAG, 'recorders onstop fired. pending writes:', pendingChunkWrites.size);

    if (pendingChunkWrites.size > 0) {
      await Promise.allSettled([...pendingChunkWrites]);
    }

    // Defensive: poll the actual chunk count for up to 5s.
    const db = getClientDb();
    const deadline = Date.now() + 5000;
    let chunkCount = 0;
    while (Date.now() < deadline) {
      chunkCount = await db.screenChunks.where('recordingId').equals(recordingId).count();
      if (chunkCount > 0) break;
      if (pendingChunkWrites.size > 0) {
        await Promise.allSettled([...pendingChunkWrites]);
        continue;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const camChunkCount = await db.screenCameraChunks.where('recordingId').equals(recordingId).count();
    console.info(LOG_TAG, 'final chunk counts — screen:', chunkCount, 'camera:', camChunkCount, 'dropped:', droppedEmpty);

    composite.stop();
    if (pipHandle) {
      await pipHandle.close();
      pipHandle = null;
    }
    // For 'overlay' bubble source: ensure the camera stream itself is stopped
    // (cameraRecorder.stop() doesn't stop the underlying tracks).
    if (cameraStream) {
      try { cameraStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    }

    if (chunkCount === 0) {
      try { await db.screenRecordings.delete(recordingId); } catch { /* */ }
      throw new Error(
        `no_data_captured: 录制未产生任何视频数据（dropped=${droppedEmpty}）。\n` +
        '常见原因：getDisplayMedia 后没拿到帧（macOS 屏幕录制权限被拒？显示器进入睡眠？）。\n' +
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
    if (screenRecorder.state !== 'inactive') {
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
    micError,
    cameraError,
    displaySurface,
    bubbleSource,
    previewActive,
    getElapsedMs: elapsed,
    pause: () => {
      if (paused) return;
      try { screenRecorder.pause(); } catch { /* */ }
      try { cameraRecorder?.pause(); } catch { /* */ }
      paused = true;
      pauseStartedAt = Date.now();
    },
    resume: () => {
      if (!paused) return;
      try { screenRecorder.resume(); } catch { /* */ }
      try { cameraRecorder?.resume(); } catch { /* */ }
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    },
    stop: stopInternal,
  };
}
