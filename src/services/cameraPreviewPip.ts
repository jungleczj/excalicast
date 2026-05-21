'use client';

const LOG_TAG = '[cameraPreviewPip v1]';

export interface PipHandle {
  /** Off-DOM `<video>` element bound to the stream; we keep a reference so
   *  we can call exitPictureInPicture on it. */
  video: HTMLVideoElement;
  /** Whether the OS-level PiP window is currently presenting. */
  isOpen: () => boolean;
  close: () => Promise<void>;
}

/**
 * Open a camera preview as an OS-level Picture-in-Picture overlay using the
 * widely-supported `HTMLVideoElement.requestPictureInPicture()` API.
 *
 * Why this matters for the screen-record architecture:
 *   PiP windows are rendered by the browser at OS level — they are NOT part
 *   of any tab or any application window. So when the user picks a tab or a
 *   window in getDisplayMedia, the PiP overlay is never captured, and we
 *   need ffmpeg to overlay the camera onto the recording at export time.
 *
 *   The one exception is when the user picks `'monitor'` (entire screen) —
 *   the PiP physically sits on the monitor and IS captured. The caller is
 *   expected to set `bubbleSource = 'in_screen'` in that case and skip the
 *   ffmpeg overlay (else two bubbles).
 *
 * This function requires a transient user activation. Call it inside the
 * same user-gesture handler that requested the camera (e.g. the modal's
 * "选择录制源" button click).
 *
 * Returns null on any failure (browser doesn't support video PiP, user
 * rejected, etc.). Callers should gracefully accept "no live preview" in
 * that case — the canvas + ffmpeg overlay path still produces ONE bubble in
 * the final video.
 */
export async function openCameraPreview(
  stream: MediaStream,
): Promise<PipHandle | null> {
  const proto = typeof HTMLVideoElement !== 'undefined' ? HTMLVideoElement.prototype : null;
  if (!proto || typeof (proto as unknown as { requestPictureInPicture?: unknown }).requestPictureInPicture !== 'function') {
    console.warn(LOG_TAG, 'requestPictureInPicture not supported in this browser');
    return null;
  }

  // The <video> must be attached to the DOM (hidden off-screen is fine) so
  // Chrome reliably advances readyState past 1 and allows PiP. Orphan video
  // nodes are sometimes refused.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(host);

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  host.appendChild(video);

  try {
    await video.play();
  } catch (err) {
    console.warn(LOG_TAG, 'video.play() rejected:', err);
    // Continue — readyState may advance anyway
  }

  // Wait briefly for the first frame so requestPictureInPicture has data
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) return resolve();
    const onReady = (): void => {
      video.removeEventListener('loadeddata', onReady);
      resolve();
    };
    video.addEventListener('loadeddata', onReady);
    setTimeout(resolve, 1500);
  });

  try {
    await video.requestPictureInPicture();
  } catch (err) {
    console.warn(LOG_TAG, 'requestPictureInPicture failed:', err);
    try { host.remove(); } catch { /* */ }
    return null;
  }

  console.info(LOG_TAG, 'PiP opened');

  let closed = false;
  const onLeave = (): void => {
    // User clicked the OS-level close button on the PiP window
    closed = true;
    console.info(LOG_TAG, 'PiP closed by user');
  };
  video.addEventListener('leavepictureinpicture', onLeave);

  return {
    video,
    isOpen: () => !closed,
    close: async () => {
      video.removeEventListener('leavepictureinpicture', onLeave);
      if (document.pictureInPictureElement === video) {
        try { await document.exitPictureInPicture(); } catch { /* */ }
      }
      try { video.pause(); } catch { /* */ }
      try { host.remove(); } catch { /* */ }
      closed = true;
    },
  };
}
