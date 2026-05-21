'use client';

const LOG_TAG = '[liveComposite v5]';

/**
 * Pattern B (dual-stream) live composite — screen only, NO camera.
 *
 * The camera is recorded by its own parallel MediaRecorder (see
 * screenRecording.ts) and composited onto the screen at EXPORT time via
 * ffmpeg overlay. This file produces just the screen+audio MediaStream that
 * feeds the screen MediaRecorder.
 *
 * Renamed conceptually to "screenComposite" but kept under the old filename
 * until the dust settles to avoid churn. All imports use this file path.
 */

export interface CompositeInputs {
  displayStream: MediaStream;
  micStream: MediaStream | null;
  systemAudioTrack: MediaStreamTrack | null;
}

export interface CompositeOutput {
  outputStream: MediaStream;
  output: { width: number; height: number };
  stop: () => void;
}

export interface CompositeOptions {
  fps: number;
}

function waitVideoReady(v: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 1) {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      v.removeEventListener('loadedmetadata', finish);
      v.removeEventListener('loadeddata', finish);
      v.removeEventListener('canplay', finish);
      resolve();
    };
    v.addEventListener('loadedmetadata', finish);
    v.addEventListener('loadeddata', finish);
    v.addEventListener('canplay', finish);
    setTimeout(finish, timeoutMs);
  });
}

export async function startLiveComposite(
  inputs: CompositeInputs,
  opts: CompositeOptions,
): Promise<CompositeOutput> {
  // Hidden DOM host so Chrome reliably advances readyState past 1 for video tags.
  const hiddenHost = document.createElement('div');
  hiddenHost.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(hiddenHost);

  const displayVideo = document.createElement('video');
  displayVideo.srcObject = inputs.displayStream;
  displayVideo.muted = true;
  displayVideo.playsInline = true;
  hiddenHost.appendChild(displayVideo);
  const displayPlay = displayVideo.play().catch((err) => {
    console.warn(LOG_TAG, 'displayVideo.play() rejected:', err);
  });

  // Wait briefly for metadata before sizing the canvas; bound to 3s.
  await Promise.race([displayPlay, waitVideoReady(displayVideo, 3000)]);
  await waitVideoReady(displayVideo, 3000);

  const settings = inputs.displayStream.getVideoTracks()[0]?.getSettings() ?? {};
  const W = (displayVideo.videoWidth || settings.width || 1280);
  const H = (displayVideo.videoHeight || settings.height || 720);
  console.info(LOG_TAG, 'canvas size:', W, 'x', H, 'displayVideo.readyState=', displayVideo.readyState);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_2d_unavailable');

  // CRITICAL: paint one frame so captureStream produces data immediately.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  let running = true;
  let frameCounter = 0;
  const drawFrame = (): void => {
    if (!running) return;
    if (displayVideo.readyState >= 2) {
      ctx.drawImage(displayVideo, 0, 0, W, H);
    } else if (frameCounter % 30 === 0) {
      // Keep canvas modified during warm-up so captureStream keeps firing.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    frameCounter++;
    if (frameCounter === 60) {
      console.info(LOG_TAG, 'frame 60 — displayReady=', displayVideo.readyState);
    }
    requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);

  const videoTrack = canvas.captureStream(opts.fps).getVideoTracks()[0];

  // Audio: only allocate the AudioContext when at least one real audio source
  // is present, else the destination still has a (silent) track which trips
  // Chrome's MediaRecorder into emitting empty chunks when opus is declared.
  const hasRealAudio = !!(inputs.micStream || inputs.systemAudioTrack);
  let audioCtx: AudioContext | null = null;
  const audioTracksForOutput: MediaStreamTrack[] = [];
  if (hasRealAudio) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    if (inputs.micStream) {
      audioCtx.createMediaStreamSource(inputs.micStream).connect(dest);
    }
    if (inputs.systemAudioTrack) {
      const sysStream = new MediaStream([inputs.systemAudioTrack]);
      audioCtx.createMediaStreamSource(sysStream).connect(dest);
    }
    audioTracksForOutput.push(...dest.stream.getAudioTracks());
  }
  console.info(LOG_TAG, 'audio inputs:', {
    micStream: !!inputs.micStream,
    systemAudio: !!inputs.systemAudioTrack,
    hasRealAudio,
    outputAudioTrackCount: audioTracksForOutput.length,
  });

  const outputStream = new MediaStream([
    videoTrack,
    ...audioTracksForOutput,
  ]);

  return {
    outputStream,
    output: { width: W, height: H },
    stop: () => {
      running = false;
      videoTrack.stop();
      try { audioCtx?.close(); } catch { /* */ }
      try { inputs.displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.systemAudioTrack?.stop(); } catch { /* */ }
      try { hiddenHost.remove(); } catch { /* */ }
    },
  };
}
