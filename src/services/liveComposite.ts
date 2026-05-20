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
  const displayVideo = document.createElement('video');
  displayVideo.srcObject = inputs.displayStream;
  displayVideo.muted = true;
  void displayVideo.play();

  const cameraVideo = inputs.cameraStream ? document.createElement('video') : null;
  if (cameraVideo && inputs.cameraStream) {
    cameraVideo.srcObject = inputs.cameraStream;
    cameraVideo.muted = true;
    void cameraVideo.play();
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

  let cameraX = opts.initialCameraPosition.x;
  let cameraY = opts.initialCameraPosition.y;

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
    },
  };
}
