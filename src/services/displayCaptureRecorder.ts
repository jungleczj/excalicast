'use client';

import { getClientDb } from '@/lib/db-client';
import type { RecordingSourceConfig } from '@/types/recording';

export interface DisplayCaptureHandle {
  sourceStream: MediaStream;
  recordedStream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}

function mimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  return 'video/webm';
}

export async function acquireDisplayStream(source: RecordingSourceConfig): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('display_capture_not_supported');
  }
  const video: MediaTrackConstraints & { displaySurface?: 'browser' | 'window' | 'monitor' } = {
    frameRate: { ideal: 30, max: 60 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(source.displaySurface ? { displaySurface: source.displaySurface } : {}),
  };
  const options = {
    video,
    audio: source.captureSystemAudio ? true : false,
    ...(source.kind === 'current_tab' ? { preferCurrentTab: true } : {}),
  } as DisplayMediaStreamOptions & { preferCurrentTab?: boolean };
  return navigator.mediaDevices.getDisplayMedia(options);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { rx: number; ry: number; rw: number; rh: number } | undefined,
  width: number,
  height: number,
): void {
  const vw = video.videoWidth || width;
  const vh = video.videoHeight || height;
  const source = crop
    ? { sx: crop.rx * vw, sy: crop.ry * vh, sw: crop.rw * vw, sh: crop.rh * vh }
    : { sx: 0, sy: 0, sw: vw, sh: vh };
  ctx.drawImage(video, source.sx, source.sy, source.sw, source.sh, 0, 0, width, height);
}

async function createSelectedAreaStream(
  sourceStream: MediaStream,
  source: RecordingSourceConfig,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
    else video.onloadedmetadata = () => resolve();
  });

  const crop = source.sourceCropWindow;
  const cropAspect = crop
    ? (crop.rw * video.videoWidth) / (crop.rh * video.videoHeight)
    : video.videoWidth / video.videoHeight;
  const width = 1920;
  const height = Math.max(2, Math.round((width / cropAspect) / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('display_canvas_unavailable');

  let raf = 0;
  const tick = () => {
    drawCover(ctx, video, crop, width, height);
    raf = requestAnimationFrame(tick);
  };
  tick();

  const stream = canvas.captureStream(30);
  for (const audioTrack of sourceStream.getAudioTracks()) {
    stream.addTrack(audioTrack.clone());
  }
  return {
    stream,
    cleanup: () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
    },
  };
}

export async function startDisplayCaptureRecorder(
  recordingId: string,
  source: RecordingSourceConfig,
  sourceStream: MediaStream,
): Promise<DisplayCaptureHandle> {
  const db = getClientDb();
  const selectedArea = source.kind === 'selected_area'
    ? await createSelectedAreaStream(sourceStream, source)
    : null;
  const recordedStream = selectedArea?.stream ?? sourceStream;
  const recorder = new MediaRecorder(recordedStream, {
    mimeType: mimeType(),
    videoBitsPerSecond: source.kind === 'selected_area' ? 4_000_000 : 6_000_000,
  });
  let chunkIndex = 0;
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      void db.screenChunks.add({ recordingId, index: chunkIndex++, blob: event.data });
    }
  };
  recorder.start(1000);

  return {
    sourceStream,
    recordedStream,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: async () => {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve();
      });
      selectedArea?.cleanup();
      sourceStream.getTracks().forEach((track) => track.stop());
    },
  };
}
