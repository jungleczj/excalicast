'use client';

export interface DisplayCaptureRequest {
  withSystemAudio: boolean;
}

export interface DisplayCaptureResult {
  videoStream: MediaStream;       // 1 video track from the display
  systemAudioTrack: MediaStreamTrack | null;
  // When user picks 'window' or denies sysAudio, this is null; UI should fall back gracefully.
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
      // @ts-expect-error displaySurface is in the spec but not in all TS lib versions
      displaySurface: 'browser',
      frameRate: { ideal: 30, max: 60 },
    },
    audio: req.withSystemAudio,
  };

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
