'use client';

import { getVideoBackgroundPreset, resolveVideoBackground } from '@/config/videoBackgrounds';
import type { VideoBackgroundConfig } from '@/types/recording';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`background_load_failed:${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
): void {
  const iw = img.width || width;
  const ih = img.height || height;
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

export async function paintVideoBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config?: VideoBackgroundConfig,
): Promise<void> {
  const bg = resolveVideoBackground(config);
  if (bg.kind === 'none') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (bg.kind === 'color') {
    ctx.fillStyle = bg.color ?? '#fffdf8';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const preset = getVideoBackgroundPreset(bg.presetId);
  if (!preset) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  try {
    const img = await loadImage(preset.asset);
    ctx.save();
    if ((bg.blurPx ?? 0) > 0) ctx.filter = `blur(${bg.blurPx}px)`;
    drawCover(ctx, img, width, height);
    ctx.restore();
    const dim = Math.max(0, Math.min(1, bg.dim ?? 0));
    if (dim > 0) {
      ctx.fillStyle = `rgba(255, 253, 248, ${dim})`;
      ctx.fillRect(0, 0, width, height);
    }
  } catch {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
}
