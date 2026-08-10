import type { AutoZoomSegment, HighlightEffectSegment, KeyPointMotionSegment } from '@/types/recording';
import { highlightAt, resolveHighlightFrameState } from '@/services/highlightEffects';
import { keyPointMotionAt, resolveKeyPointMotionState } from '@/services/keyPointMotion';
import { resolveFrameTransform, type FrameRect } from '@/services/frameTransform';

type NormalizedRect = { x: number; y: number; width: number; height: number };

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: FrameRect, radius: number): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
  ctx.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r);
  ctx.closePath();
}

function clampRect(rect: FrameRect, bounds: FrameRect): FrameRect {
  const left = Math.max(bounds.x, rect.x);
  const top = Math.max(bounds.y, rect.y);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function projectHighlightAperture(
  bounds: FrameRect,
  region: NormalizedRect,
  zoom?: Pick<AutoZoomSegment, 'scale' | 'cx' | 'cy'> | null,
): FrameRect {
  const sourceRect = {
    x: bounds.x + region.x * bounds.width,
    y: bounds.y + region.y * bounds.height,
    width: region.width * bounds.width,
    height: region.height * bounds.height,
  };
  const transform = resolveFrameTransform({ bounds, zoom });
  const scaleX = transform.destination.width / transform.source.width;
  const scaleY = transform.destination.height / transform.source.height;
  return clampRect({
    x: transform.destination.x + (sourceRect.x - transform.source.x) * scaleX,
    y: transform.destination.y + (sourceRect.y - transform.source.y) * scaleY,
    width: sourceRect.width * scaleX,
    height: sourceRect.height * scaleY,
  }, bounds);
}

export function drawHighlightEffect(
  ctx: CanvasRenderingContext2D,
  segments: HighlightEffectSegment[] | undefined,
  timeMs: number,
  bounds: FrameRect,
  zoom?: AutoZoomSegment | null,
): void {
  const segment = highlightAt(segments, timeMs);
  if (!segment) return;
  const state = resolveHighlightFrameState(segment, timeMs);
  if (!state.active) return;
  const aperture = projectHighlightAperture(bounds, state.aperture, zoom);
  if (aperture.width <= 0 || aperture.height <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();

  if (state.maskOpacity > 0) {
    ctx.fillStyle = `rgba(8, 12, 18, ${state.maskOpacity.toFixed(4)})`;
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.rect(aperture.x, aperture.y, aperture.width, aperture.height);
    ctx.fill('evenodd');
  }

  if (segment.enabled.focusFrame && state.focusProgress > 0) {
    ctx.save();
    ctx.globalAlpha = state.focusProgress;
    ctx.strokeStyle = '#5ee6c2';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(bounds.width, bounds.height) * 0.004));
    ctx.shadowColor = 'rgba(20, 255, 205, 0.28)';
    ctx.shadowBlur = Math.max(5, Math.round(ctx.lineWidth * 2.5));
    roundedRectPath(ctx, aperture, Math.max(5, Math.min(aperture.width, aperture.height) * 0.04));
    ctx.stroke();
    ctx.restore();
  }

  if (segment.enabled.cursorHalo && state.haloOpacity > 0) {
    const centerX = aperture.x + aperture.width / 2;
    const centerY = aperture.y + aperture.height / 2;
    const radius = Math.max(12, Math.min(bounds.width, bounds.height) * 0.035 * state.haloScale);
    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(255, 225, 82, ${(0.5 * state.haloOpacity).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(255, 225, 82, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (segment.enabled.textCallout && segment.calloutText && state.calloutOpacity > 0) {
    const fontSize = Math.max(14, Math.round(Math.min(bounds.width, bounds.height) * 0.032));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    const padX = Math.round(fontSize * 0.72);
    const padY = Math.round(fontSize * 0.48);
    const text = segment.calloutText.slice(0, 120);
    const boxWidth = Math.min(bounds.width * 0.72, ctx.measureText(text).width + padX * 2);
    const boxHeight = fontSize + padY * 2;
    const preferredY = aperture.y + aperture.height + fontSize * 0.55 + state.calloutOffset;
    const box = {
      x: Math.max(bounds.x + 8, Math.min(bounds.x + bounds.width - boxWidth - 8, aperture.x)),
      y: preferredY + boxHeight <= bounds.y + bounds.height - 8
        ? preferredY
        : Math.max(bounds.y + 8, aperture.y - boxHeight - fontSize * 0.55 - state.calloutOffset),
      width: boxWidth,
      height: boxHeight,
    };
    ctx.save();
    ctx.globalAlpha = state.calloutOpacity;
    ctx.fillStyle = 'rgba(20, 24, 28, 0.9)';
    roundedRectPath(ctx, box, Math.max(6, fontSize * 0.42));
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, box.x + padX, box.y + box.height / 2, box.width - padX * 2);
    ctx.restore();
  }

  ctx.restore();
}

function keyPointRect(segment: KeyPointMotionSegment, bounds: FrameRect): FrameRect {
  if (segment.kind === 'chapter_title') {
    const width = bounds.width * 0.68;
    const height = bounds.height * 0.2;
    return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + bounds.height * 0.37, width, height };
  }
  if (segment.kind === 'lower_third') {
    const width = bounds.width * 0.62;
    const height = bounds.height * 0.18;
    const x = segment.placement === 'right'
      ? bounds.x + bounds.width - width - bounds.width * 0.05
      : bounds.x + bounds.width * 0.05;
    return { x, y: bounds.y + bounds.height * 0.66, width, height };
  }
  const width = bounds.width * 0.34;
  const height = bounds.height * 0.42;
  const useRight = segment.placement === 'right';
  return {
    x: useRight ? bounds.x + bounds.width - width - bounds.width * 0.05 : bounds.x + bounds.width * 0.05,
    y: bounds.y + bounds.height * 0.18,
    width,
    height,
  };
}

export function drawKeyPointMotion(
  ctx: CanvasRenderingContext2D,
  segments: KeyPointMotionSegment[] | undefined,
  timeMs: number,
  bounds: FrameRect,
  options: { reserveRight?: boolean } = {},
): void {
  const segment = keyPointMotionAt(segments, timeMs);
  if (!segment) return;
  const state = resolveKeyPointMotionState(segment, timeMs);
  if (!state.active || state.opacity <= 0) return;
  const resolved = segment.placement === 'auto'
    ? { ...segment, placement: options.reserveRight ? 'left' as const : (segment.kind === 'side_card' ? 'right' as const : 'left' as const) }
    : segment;
  const rect = keyPointRect(resolved, bounds);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const titleSize = Math.max(16, Math.round(Math.min(bounds.width, bounds.height) * (segment.kind === 'chapter_title' ? 0.055 : 0.035)));
  const bodySize = Math.max(12, Math.round(titleSize * 0.56));

  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();
  ctx.globalAlpha = state.opacity;
  ctx.translate(centerX, centerY + state.translateY);
  ctx.scale(state.scale, state.scale);
  ctx.translate(-centerX, -centerY);
  ctx.fillStyle = segment.kind === 'chapter_title' ? 'rgba(16, 20, 26, 0.9)' : 'rgba(255, 253, 248, 0.94)';
  roundedRectPath(ctx, rect, Math.max(8, Math.min(rect.width, rect.height) * 0.07));
  ctx.fill();
  ctx.strokeStyle = segment.kind === 'chapter_title' ? 'rgba(255,255,255,0.3)' : 'rgba(24,25,26,0.24)';
  ctx.lineWidth = Math.max(1, Math.round(Math.min(bounds.width, bounds.height) * 0.002));
  ctx.stroke();

  const textColor = segment.kind === 'chapter_title' ? '#fffdf8' : '#18191a';
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'top';
  ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
  const pad = Math.max(12, Math.round(rect.width * 0.07));
  ctx.fillText(segment.title.slice(0, 120), rect.x + pad, rect.y + pad, rect.width - pad * 2);
  if (segment.bullets.length > 0) {
    ctx.font = `500 ${bodySize}px system-ui, sans-serif`;
    let y = rect.y + pad + titleSize * 1.35;
    const lineHeight = bodySize * 1.42;
    for (const bullet of segment.bullets.slice(0, 4)) {
      if (y + lineHeight > rect.y + rect.height - pad) break;
      ctx.fillText(`• ${bullet.slice(0, 100)}`, rect.x + pad, y, rect.width - pad * 2);
      y += lineHeight;
    }
  }
  ctx.restore();
}
