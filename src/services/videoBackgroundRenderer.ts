'use client';

import { getVideoBackgroundPreset, resolveVideoBackground } from '@/config/videoBackgrounds';
import type { VideoBackgroundConfig } from '@/types/recording';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export interface CoverPlacement {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface PaintVideoBackgroundOptions {
  signal?: AbortSignal;
  fallbackFrame?: CanvasImageSource & {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Background render superseded', 'AbortError');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`background_load_failed:${src}`));
    img.src = src;
  }).catch((error) => {
    imageCache.delete(src);
    throw error;
  });
  imageCache.set(src, promise);
  return promise;
}

export function resolveCoverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CoverPlacement {
  const sw = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : targetWidth;
  const sh = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : targetHeight;
  const dw = Math.max(1, targetWidth);
  const dh = Math.max(1, targetHeight);
  const sourceAspect = sw / sh;
  const targetAspect = dw / dh;

  if (sourceAspect > targetAspect) {
    const cropWidth = sh * targetAspect;
    return {
      sx: (sw - cropWidth) / 2,
      sy: 0,
      sw: cropWidth,
      sh,
      dx: 0,
      dy: 0,
      dw,
      dh,
    };
  }

  const cropHeight = sw / targetAspect;
  return {
    sx: 0,
    sy: (sh - cropHeight) / 2,
    sw,
    sh: cropHeight,
    dx: 0,
    dy: 0,
    dw,
    dh,
  };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  },
  width: number,
  height: number,
): void {
  const sourceWidth = img.videoWidth ?? img.displayWidth ?? img.width ?? width;
  const sourceHeight = img.videoHeight ?? img.displayHeight ?? img.height ?? height;
  const placement = resolveCoverPlacement(sourceWidth, sourceHeight, width, height);
  ctx.drawImage(
    img,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    placement.dx,
    placement.dy,
    placement.dw,
    placement.dh,
  );
}

export async function paintVideoBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config?: VideoBackgroundConfig,
  options: PaintVideoBackgroundOptions = {},
): Promise<void> {
  abortIfNeeded(options.signal);
  const bg = resolveVideoBackground(config);
  if (bg.kind === 'none') {
    ctx.clearRect(0, 0, width, height);
    if (options.fallbackFrame) drawCover(ctx, options.fallbackFrame, width, height);
    return;
  }

  if (bg.kind === 'color') {
    ctx.fillStyle = bg.color ?? '#fffdf8';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const preset = getVideoBackgroundPreset(bg.presetId);
  if (!preset) {
    throw new Error(`background_preset_not_found:${bg.presetId ?? 'unknown'}`);
  }

  const img = await loadImage(preset.asset);
  abortIfNeeded(options.signal);
  ctx.save();
  if ((bg.blurPx ?? 0) > 0) ctx.filter = `blur(${bg.blurPx}px)`;
  drawCover(ctx, img, width, height);
  ctx.restore();
  const dim = Math.max(0, Math.min(1, bg.dim ?? 0));
  if (dim > 0) {
    ctx.fillStyle = `rgba(255, 253, 248, ${dim})`;
    ctx.fillRect(0, 0, width, height);
  }
}
