'use client';

const LOG_TAG = '[liveComposite v4]';

export interface CompositeInputs {
  displayStream: MediaStream;
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  systemAudioTrack: MediaStreamTrack | null;
}

export interface CompositeOutput {
  outputStream: MediaStream;
  output: { width: number; height: number };
  setCameraPosition: (pos: { x: number; y: number }) => void;
  stop: () => void;
}

export interface CompositeOptions {
  fps: number;                       // 30
  cameraSizePx: number;              // diameter; default 160
  initialCameraPosition: { x: number; y: number };
}

function waitVideoReady(v: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    // Resolve immediately once we have ANY readiness signal — width/height
    // requirement was too strict for some browsers / test stubs.
    if (v.readyState >= 1) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
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

/**
 * Build a single output MediaStream that mixes:
 *   - display video (drawn into canvas)
 *   - camera bubble (drawn on top, circular crop)
 *   - mic + optional system audio (mixed via AudioContext)
 *
 * The output canvas has no watermark and no subtitles — those are decided
 * at download time (so Pro purchase retroactively removes watermark).
 *
 * Returns a Promise: we await displayVideo metadata so we can size the canvas
 * to the real captured dimensions rather than guessing.
 */
export async function startLiveComposite(
  inputs: CompositeInputs,
  opts: CompositeOptions,
): Promise<CompositeOutput> {
  // Holder for off-screen video elements. Attaching to DOM (even invisible)
  // is required for Chrome to reliably advance readyState past 1.
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

  const cameraVideo = inputs.cameraStream ? document.createElement('video') : null;
  if (cameraVideo && inputs.cameraStream) {
    cameraVideo.srcObject = inputs.cameraStream;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    hiddenHost.appendChild(cameraVideo);
    void cameraVideo.play().catch((err) => {
      console.warn(LOG_TAG, 'cameraVideo.play() rejected:', err);
    });
  }

  // Wait for display metadata so we know the real dimensions before sizing
  // the output canvas. Bound to 3s so we don't hang if metadata never arrives.
  await Promise.race([displayPlay, waitVideoReady(displayVideo, 3000)]);
  await waitVideoReady(displayVideo, 3000);

  // Use the actual decoded dimensions; fall back to track settings; final
  // fallback to 1280x720.
  const settings = inputs.displayStream.getVideoTracks()[0]?.getSettings() ?? {};
  const W = (displayVideo.videoWidth || settings.width || 1280);
  const H = (displayVideo.videoHeight || settings.height || 720);
  console.info(LOG_TAG, 'canvas size:', W, 'x', H, 'displayVideo.readyState=', displayVideo.readyState);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_2d_unavailable');

  // CRITICAL: paint at least one initial frame BEFORE handing the canvas
  // stream to MediaRecorder. canvas.captureStream() only emits frames after
  // the canvas has been modified. Without this, MediaRecorder may receive
  // zero frames if the display video is slow to be ready.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Clamp camera position into canvas bounds (callers pass window-pixel coords
  // which may be larger than the canvas).
  const margin = 24;
  const maxX = Math.max(margin, W - opts.cameraSizePx - margin);
  const maxY = Math.max(margin, H - opts.cameraSizePx - margin);
  let cameraX = Math.min(Math.max(opts.initialCameraPosition.x, margin), maxX);
  let cameraY = Math.min(Math.max(opts.initialCameraPosition.y, margin), maxY);
  if (cameraX + opts.cameraSizePx > W) cameraX = Math.max(0, W - opts.cameraSizePx - margin);
  if (cameraY + opts.cameraSizePx > H) cameraY = Math.max(0, H - opts.cameraSizePx - margin);

  let running = true;
  let frameCounter = 0;
  const drawFrame = () => {
    if (!running) return;
    if (displayVideo.readyState >= 2) {
      ctx.drawImage(displayVideo, 0, 0, W, H);
    } else if (frameCounter % 30 === 0) {
      // Display not ready yet — keep canvas modified so captureStream still
      // emits frames; paint a moving placeholder so the user sees feedback
      // if they're somehow viewing the canvas.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    if (cameraVideo && cameraVideo.readyState >= 2) {
      const r = opts.cameraSizePx / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cameraX + r, cameraY + r, r, 0, Math.PI * 2);
      ctx.clip();
      // mirror horizontally to match user expectation
      ctx.translate(cameraX + r, cameraY + r);
      ctx.scale(-1, 1);
      ctx.translate(-(cameraX + r), -(cameraY + r));
      ctx.drawImage(cameraVideo, cameraX, cameraY, opts.cameraSizePx, opts.cameraSizePx);
      ctx.restore();
      // ring stroke
      ctx.beginPath();
      ctx.arc(cameraX + r, cameraY + r, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
    frameCounter++;
    if (frameCounter === 60) {
      console.info(LOG_TAG, 'frame 60 — displayReady=', displayVideo.readyState,
        'cameraReady=', cameraVideo?.readyState ?? 'n/a',
        'cameraPos=', cameraX, cameraY, 'cameraSize=', opts.cameraSizePx);
    }
    requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);

  const videoTrack = canvas.captureStream(opts.fps).getVideoTracks()[0];

  // Audio mix — but ONLY build the AudioContext + destination if we actually
  // have a real audio input. The MediaStreamAudioDestinationNode always has
  // a track even with no sources connected (it emits silence), but Chrome's
  // MediaRecorder stalls when the declared codec is opus and the track is a
  // phantom silent one with no source feeding it. We saw this in the user's
  // session: hundreds of empty chunks dropped.
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
    setCameraPosition: (pos) => {
      cameraX = pos.x;
      cameraY = pos.y;
    },
    stop: () => {
      running = false;
      videoTrack.stop();
      try { audioCtx?.close(); } catch { /* ignore */ }
      try { inputs.displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.cameraStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.systemAudioTrack?.stop(); } catch { /* */ }
      try { hiddenHost.remove(); } catch { /* */ }
    },
  };
}
