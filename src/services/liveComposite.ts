'use client';

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

/**
 * Build a single output MediaStream that mixes:
 *   - display video (drawn into canvas)
 *   - camera bubble (drawn on top, circular crop)
 *   - mic + optional system audio (mixed via AudioContext)
 *
 * The output canvas has no watermark and no subtitles — those are decided
 * at download time (so Pro purchase retroactively removes watermark).
 */
export function startLiveComposite(
  inputs: CompositeInputs,
  opts: CompositeOptions,
): CompositeOutput {
  // Holder for off-screen video elements. Attaching to DOM (even invisible)
  // makes browser autoplay + frame production more reliable than orphan
  // <video> nodes — without DOM attachment, Chrome sometimes never advances
  // `readyState` past 1, so drawImage paints nothing.
  const hiddenHost = document.createElement('div');
  hiddenHost.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(hiddenHost);

  const displayVideo = document.createElement('video');
  displayVideo.srcObject = inputs.displayStream;
  displayVideo.muted = true;
  displayVideo.playsInline = true;
  hiddenHost.appendChild(displayVideo);
  void displayVideo.play().catch(() => { /* autoplay may reject in some cases */ });

  const cameraVideo = inputs.cameraStream ? document.createElement('video') : null;
  if (cameraVideo && inputs.cameraStream) {
    cameraVideo.srcObject = inputs.cameraStream;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    hiddenHost.appendChild(cameraVideo);
    void cameraVideo.play().catch(() => { /* same */ });
  }

  // Best-effort initial sizing: settings may report nominal dims; Chrome updates
  // them after the first frame. We pick the displayed track's settings, defaulting
  // to 1920×1080 if not yet known.
  const settings = inputs.displayStream.getVideoTracks()[0].getSettings();
  const W = settings.width ?? 1920;
  const H = settings.height ?? 1080;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_2d_unavailable');

  // Caller passes initialCameraPosition in window pixel coords (its convenient
  // frame of reference), but the canvas might be a totally different size
  // (e.g. 1280×720 from getDisplayMedia, while the window is 1920×1080).
  // Clamp into canvas bounds, else the bubble draws off-screen and never
  // appears in the recorded video.
  const margin = 24;
  const maxX = Math.max(margin, W - opts.cameraSizePx - margin);
  const maxY = Math.max(margin, H - opts.cameraSizePx - margin);
  let cameraX = Math.min(Math.max(opts.initialCameraPosition.x, margin), maxX);
  let cameraY = Math.min(Math.max(opts.initialCameraPosition.y, margin), maxY);
  // If the clamped value still puts the bubble outside (canvas smaller than
  // bubble + margin), pin to bottom-right.
  if (cameraX + opts.cameraSizePx > W) cameraX = Math.max(0, W - opts.cameraSizePx - margin);
  if (cameraY + opts.cameraSizePx > H) cameraY = Math.max(0, H - opts.cameraSizePx - margin);

  let running = true;
  const drawFrame = () => {
    if (!running) return;
    if (displayVideo.readyState >= 2) {
      ctx.drawImage(displayVideo, 0, 0, W, H);
    }
    if (cameraVideo && cameraVideo.readyState >= 2) {
      const r = opts.cameraSizePx / 2;
      ctx.save();
      // mirror horizontally to match user expectation
      ctx.beginPath();
      ctx.arc(cameraX + r, cameraY + r, r, 0, Math.PI * 2);
      ctx.clip();
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
    requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);

  const videoTrack = canvas.captureStream(opts.fps).getVideoTracks()[0];

  // Audio mix
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  if (inputs.micStream) {
    audioCtx.createMediaStreamSource(inputs.micStream).connect(dest);
  }
  if (inputs.systemAudioTrack) {
    const sysStream = new MediaStream([inputs.systemAudioTrack]);
    audioCtx.createMediaStreamSource(sysStream).connect(dest);
  }

  const outputStream = new MediaStream([
    videoTrack,
    ...dest.stream.getAudioTracks(),
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
      try { audioCtx.close(); } catch { /* ignore */ }
      try { inputs.displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.cameraStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.systemAudioTrack?.stop(); } catch { /* */ }
      try { hiddenHost.remove(); } catch { /* */ }
    },
  };
}
