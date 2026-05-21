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
import {
  assertNotBlackFrames,
  captureDisplayWithAbort,
  makeScreenError,
  SCREEN_ERROR,
  type AbortFlag,
} from '@/services/displayCapture';
import { startLiveComposite, type CompositeOutput } from '@/services/liveComposite';
import { openCameraPreview, type PipHandle } from '@/services/cameraPreviewPip';
import type {
  BubbleSource,
  DisplaySurface,
  ScreenRecordingMetadata,
} from '@/types/recording';

const LOG_TAG = '[screenRecording v6]';

export interface StartScreenRecordingOpts {
  withSystemAudio: boolean;
  /** Mic stream pre-acquired by the setup modal. null = user didn't enable mic or permission failed. */
  presetMicStream: MediaStream | null;
  /** Camera stream pre-acquired by the setup modal. null = user didn't enable camera or permission failed. */
  presetCameraStream: MediaStream | null;
  /** Abort signal shared with the UI. Setting `aborted=true` cancels the current picker wait. */
  abortFlag: AbortFlag;
}

export interface ScreenRecordingHandle {
  recordingId: string;
  startedAt: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
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

/** Module-level mutex: prevents HMR re-renders or double-clicks from starting
 *  two parallel recordings (the previous architecture would leak both streams
 *  and confuse IndexedDB). */
let inflightStart: Promise<ScreenRecordingHandle> | null = null;

export async function startScreenRecording(opts: StartScreenRecordingOpts): Promise<ScreenRecordingHandle> {
  if (inflightStart) {
    console.warn(LOG_TAG, 'startScreenRecording already in flight — returning existing promise');
    return inflightStart;
  }
  inflightStart = (async () => {
    try {
      return await _startInner(opts);
    } finally {
      inflightStart = null;
    }
  })();
  return inflightStart;
}

async function _startInner(opts: StartScreenRecordingOpts): Promise<ScreenRecordingHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();
  console.info(LOG_TAG, 'STAGE 0 entered. opts=', {
    withSystemAudio: opts.withSystemAudio,
    hasPresetMic: !!opts.presetMicStream,
    hasPresetCamera: !!opts.presetCameraStream,
  });

  // Preset streams from the setup modal — recording owns them now.
  const micStream: MediaStream | null = opts.presetMicStream;
  const cameraStream: MediaStream | null = opts.presetCameraStream;
  const hasMic = !!micStream;
  const hasCamera = !!cameraStream;

  // Cleanup helper for fail-fast paths so we don't leak the preset streams.
  const releasePresets = (): void => {
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { cameraStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  };

  // STAGE 1: Display capture (the only OS permission still pending). Wrapped
  // with abortFlag race so the UI can cancel while the picker is open.
  console.info(LOG_TAG, 'STAGE 1 calling captureDisplayWithAbort …');
  let displayStream: MediaStream;
  let systemAudioTrack: MediaStreamTrack | null;
  try {
    const result = await captureDisplayWithAbort(
      { withSystemAudio: opts.withSystemAudio },
      opts.abortFlag,
    );
    displayStream = result.videoStream;
    systemAudioTrack = result.systemAudioTrack;
  } catch (err) {
    releasePresets();
    throw err;
  }

  // If the user clicked Cancel AFTER the picker silently resolved, we must
  // discard the orphan stream so the OS-level "Chrome is recording" indicator
  // disappears.
  if (opts.abortFlag.aborted) {
    console.info(LOG_TAG, 'STAGE 1 aborted — stopping orphan stream');
    try { displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { systemAudioTrack?.stop(); } catch { /* */ }
    releasePresets();
    throw makeScreenError(SCREEN_ERROR.PICKER_CANCELLED, 'aborted after picker resolved');
  }

  // STAGE 1.5: stream sanity
  if (displayStream.getVideoTracks().length === 0) {
    releasePresets();
    try { systemAudioTrack?.stop(); } catch { /* */ }
    throw makeScreenError(SCREEN_ERROR.NO_VIDEO_TRACK, 'getDisplayMedia returned a stream without a video track');
  }
  const hasSystemAudio = systemAudioTrack !== null;
  const displaySurface = detectDisplaySurface(displayStream);
  console.info(LOG_TAG, 'STAGE 1 done. surface=', displaySurface, 'hasSysAudio=', hasSystemAudio);

  // STAGE 1.6: black-frame check (macOS TCC silent failure)
  console.info(LOG_TAG, 'STAGE 1.6 checking for black frames …');
  try {
    await assertNotBlackFrames(displayStream);
    console.info(LOG_TAG, 'STAGE 1.6 OK (frames have content)');
  } catch (err) {
    console.warn(LOG_TAG, 'STAGE 1.6 black frame check threw:', err);
    try { displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { systemAudioTrack?.stop(); } catch { /* */ }
    releasePresets();
    throw err;
  }

  // STAGE 4: PiP preview — only if we actually have a camera stream.
  let pipHandle: PipHandle | null = null;
  if (cameraStream) {
    console.info(LOG_TAG, 'STAGE 4 opening PiP preview …');
    try {
      pipHandle = await openCameraPreview(cameraStream);
      console.info(LOG_TAG, 'STAGE 4 done. pipHandle=', pipHandle ? 'opened' : 'null');
    } catch (err) {
      console.warn(LOG_TAG, 'STAGE 4 PiP attempt threw:', err);
      pipHandle = null;
    }
  } else {
    console.info(LOG_TAG, 'STAGE 4 skipped (no cameraStream)');
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
    hasMic, hasSystemAudio, hasCamera,
    displaySurface, previewActive, bubbleSource,
  });

  // 6) Screen composite (no camera path inside) + screen MediaRecorder
  console.info(LOG_TAG, 'STAGE 6 calling startLiveComposite …');
  const composite: CompositeOutput = await startLiveComposite(
    { displayStream, micStream, systemAudioTrack },
    { fps: 30 },
  );
  console.info(LOG_TAG, 'STAGE 6 done. canvas=', composite.output);

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
