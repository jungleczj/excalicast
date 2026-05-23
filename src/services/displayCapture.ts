'use client';

export interface DisplayCaptureRequest {
  withSystemAudio: boolean;
}

export interface DisplayCaptureResult {
  videoStream: MediaStream;       // 1 video track from the display
  systemAudioTrack: MediaStreamTrack | null;
  // When user picks 'window' or denies sysAudio, this is null; UI should fall back gracefully.
}

export interface AbortFlag {
  aborted: boolean;
}

/**
 * Stable error codes thrown by the display-capture path. The recording layer
 * surfaces these to the UI which routes them to specific help cards.
 */
export const SCREEN_ERROR = {
  PICKER_CANCELLED: 'PICKER_CANCELLED',
  BLACK_FRAMES: 'BLACK_FRAMES',
  NO_VIDEO_TRACK: 'NO_VIDEO_TRACK',
} as const;
export type ScreenErrorCode = typeof SCREEN_ERROR[keyof typeof SCREEN_ERROR];

export interface ScreenError extends Error {
  code: ScreenErrorCode;
}

export function makeScreenError(code: ScreenErrorCode, message: string): ScreenError {
  return Object.assign(new Error(message), { code });
}

/**
 * Trigger the system picker. The user chooses tab / window / screen.
 * Returns the resulting video stream + an optional system-audio track.
 *
 * Throws if the user denies / cancels.
 */
export async function captureDisplay(req: DisplayCaptureRequest): Promise<DisplayCaptureResult> {
  const constraints: DisplayMediaStreamOptions = {
    video: {
      // Hint Chrome to prefer browser-tab capture, but the user can still pick anything.
      displaySurface: 'browser',
      frameRate: { ideal: 30, max: 60 },
    },
    audio: req.withSystemAudio,
    // Don't allow user to pick the Excalicast tab itself — would create a
    // self-capture loop (recursive thumbnail) and is never what they want.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selfBrowserSurface: 'exclude',
  } as DisplayMediaStreamOptions;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia(constraints);

  // Split: keep video track in result.videoStream, extract sysAudio if present.
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  // Always rebuild the video stream so the caller can attach lifecycle handlers consistently.
  const videoStream = new MediaStream(videoTracks);
  const systemAudioTrack = audioTracks[0] ?? null;

  return { videoStream, systemAudioTrack };
}

/**
 * Wrapper around captureDisplay that races against an `aborted` flag. Polls
 * the flag every 100ms; if the user clicks Cancel while the OS picker is
 * still up, this promise rejects with PICKER_CANCELLED so the UI can
 * recover.
 *
 * IMPORTANT: There is no programmatic way to dismiss Chromium's display
 * picker. If the user later confirms it after we've aborted, the underlying
 * getDisplayMedia promise still resolves with a real stream — caller must
 * inspect abortFlag.aborted AFTER our race resolves and stop the orphaned
 * tracks themselves.
 */
export async function captureDisplayWithAbort(
  req: DisplayCaptureRequest,
  abortFlag: AbortFlag,
): Promise<DisplayCaptureResult> {
  const displayPromise = captureDisplay(req).catch((err) => {
    // Normalize getDisplayMedia rejections (user clicked Cancel in picker).
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'NotAllowedError') {
      throw makeScreenError(SCREEN_ERROR.PICKER_CANCELLED, 'user cancelled picker');
    }
    throw err;
  });

  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  const abortPromise = new Promise<DisplayCaptureResult>((_, reject) => {
    const check = (): void => {
      if (abortFlag.aborted) {
        reject(makeScreenError(SCREEN_ERROR.PICKER_CANCELLED, 'user clicked cancel'));
        return;
      }
      pollHandle = setTimeout(check, 100);
    };
    check();
  });

  // Whichever wins, we forward. If abort wins, the underlying picker may
  // later resolve and produce an orphan stream — caller handles that.
  try {
    return await Promise.race([displayPromise, abortPromise]);
  } finally {
    if (pollHandle !== null) clearTimeout(pollHandle);
  }
}

/**
 * After capture, sample one frame from the stream and detect if it's
 * effectively all-black. This catches the macOS TCC silent-failure case where
 * Chrome has lost its Screen Recording entitlement (e.g. after a Chrome
 * version bump) — the stream resolves but every frame is solid black.
 *
 * The whole probe is bounded by `HARD_TIMEOUT_MS` so a flaky video element
 * can never hang the start path. On timeout we log and proceed (better to
 * record than to lock the user out on a flaky check).
 */
const HARD_TIMEOUT_MS = 4_000;

export async function assertNotBlackFrames(stream: MediaStream): Promise<void> {
  // Hidden DOM host — Chromium needs the <video> attached for some pipelines
  // to advance readyState reliably.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(host);

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  host.appendChild(video);

  const cleanup = (): void => {
    try { video.pause(); } catch { /* */ }
    try { video.srcObject = null; } catch { /* */ }
    try { host.remove(); } catch { /* */ }
  };

  // Race the whole probe against a hard timeout.
  const probe = (async () => {
    try { await video.play(); } catch { /* readyState may still advance */ }

    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) { resolve(); return; }
      const onReady = (): void => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        resolve();
      };
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      // Inner bound (separate from hard timeout) — if loadeddata doesn't fire
      // in 2s the frame check still proceeds with whatever's there.
      setTimeout(() => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        resolve();
      }, 2_000);
    });

    // Some browsers (older Safari) lack OffscreenCanvas. Skip the check.
    if (typeof OffscreenCanvas === 'undefined') return;

    // Video has no dimensions yet → can't probe; skip rather than throw.
    if (!video.videoWidth || !video.videoHeight) {
      console.warn('[displayCapture] black-frame probe skipped: video has 0×0 dimensions');
      return;
    }

    const cv = new OffscreenCanvas(64, 64);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let blackPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 5 && data[i + 1] < 5 && data[i + 2] < 5) blackPixels++;
    }
    const ratio = blackPixels / (64 * 64);
    if (ratio > 0.95) {
      throw makeScreenError(
        SCREEN_ERROR.BLACK_FRAMES,
        `display stream returned all-black frames (${(ratio * 100).toFixed(0)}%) — macOS Screen Recording permission may be missing`,
      );
    }
  })();

  let timedOut = false;
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      console.warn('[displayCapture] black-frame probe HARD TIMEOUT (', HARD_TIMEOUT_MS, 'ms) — proceeding without check');
      resolve();
    }, HARD_TIMEOUT_MS);
  });

  try {
    await Promise.race([probe, timer]);
    if (timedOut) {
      // Best-effort wait so probe doesn't reject after we returned (would be uncaught).
      probe.catch(() => { /* */ });
    } else {
      await probe;
    }
  } finally {
    cleanup();
  }
}

/**
 * Get the microphone stream. Independent of display capture.
 * Throws if mic permission denied; caller handles graceful degrade.
 */
export async function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48000,    // sysAudio is typically 48k — match for clean mixing
      channelCount: 1,
    },
    video: false,
  });
}

/**
 * Get the camera stream. Independent of display capture.
 * Throws if camera permission denied; caller handles graceful degrade.
 */
export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 640 },
      facingMode: 'user',
    },
  });
}
