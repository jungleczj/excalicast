import type { AutoZoomSegment, HighlightEffectSegment, KeyPointMotionSegment } from '@/types/recording';
import { highlightAt, resolveHighlightFrameState } from '@/services/highlightEffects';
import {
  keyPointMotionAt,
  migrateKeyPointMotionSegment,
  resolveKeyPointDrawerLayout,
  resolveKeyPointDrawerState,
  tokenizeKeyPointLine,
} from '@/services/keyPointMotion';
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

function keyPointLocale(text: string): 'en' | 'zh' {
  return /\p{Script=Han}/u.test(text) ? 'zh' : 'en';
}

function keyPointGradient(
  ctx: CanvasRenderingContext2D,
  rect: FrameRect,
  placement: Exclude<KeyPointMotionSegment['placement'], 'auto'>,
): CanvasGradient {
  const gradient = placement === 'left'
    ? ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
    : placement === 'right'
      ? ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y)
      : placement === 'top'
        ? ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height)
        : ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  if (placement === 'right' || placement === 'bottom') {
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.38, 'rgba(0, 0, 0, 0.18)');
    gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0.52)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.76)');
  } else {
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.76)');
    gradient.addColorStop(0.28, 'rgba(0, 0, 0, 0.52)');
    gradient.addColorStop(0.62, 'rgba(0, 0, 0, 0.18)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  return gradient;
}

function drawStaggeredKeyPointLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  locale: 'en' | 'zh',
  x: number,
  y: number,
  align: CanvasTextAlign,
  font: string,
  tokenStates: ReturnType<typeof resolveKeyPointDrawerState>['tokens'],
): void {
  const tokens = tokenizeKeyPointLine(text, locale);
  if (!tokens.length) return;
  ctx.font = font;
  ctx.textAlign = 'left';
  const separator = locale === 'en' ? ' ' : '';
  const widths = tokens.map((token, index) => ctx.measureText(`${token}${index < tokens.length - 1 ? separator : ''}`).width);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let cursorX = align === 'right' ? x - totalWidth : align === 'center' ? x - totalWidth / 2 : x;
  tokens.forEach((token, index) => {
    const state = tokenStates[index] ?? { opacity: 1, translateY: 0 };
    ctx.save();
    ctx.globalAlpha *= state.opacity;
    ctx.fillText(token, cursorX, y + state.translateY);
    ctx.restore();
    cursorX += widths[index];
  });
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
  const migrated = migrateKeyPointMotionSegment(segment);
  const placement = migrated.placement === 'auto'
    ? (options.reserveRight ? 'left' as const : 'right' as const)
    : migrated.placement;
  const resolved = { ...migrated, placement };
  const locale = keyPointLocale([resolved.title, ...resolved.bullets].join(''));
  const visibleLines = [resolved.title, ...resolved.bullets].filter(Boolean);
  const lineTokenCounts = visibleLines.map((line) => tokenizeKeyPointLine(line, locale).length);
  const state = resolveKeyPointDrawerState(resolved, timeMs, lineTokenCounts);
  if (!state.active || state.opacity <= 0) return;
  const rect = resolveKeyPointDrawerLayout(bounds, placement);
  const translateX = state.drawerTranslateX * rect.width;
  const translateY = state.drawerTranslateY * rect.height;
  const minSide = Math.min(bounds.width, bounds.height);
  const titleSize = Math.max(22, Math.round(minSide * (resolved.kind === 'chapter_drawer' ? 0.07 : 0.058)));
  const bodySize = Math.max(18, Math.round(titleSize * 0.68));
  const lineGap = Math.max(10, Math.round(bodySize * 0.55));
  const totalHeight = titleSize + resolved.bullets.length * (bodySize + lineGap);
  const horizontal = placement === 'left' || placement === 'right';
  const align: CanvasTextAlign = placement === 'right' ? 'right' : placement === 'left' ? 'left' : 'center';
  const anchorX = placement === 'right'
    ? rect.x + rect.width * 0.86
    : placement === 'left'
      ? rect.x + rect.width * 0.14
      : rect.x + rect.width / 2;
  const startY = horizontal
    ? rect.y + (rect.height - totalHeight) / 2
    : placement === 'top'
      ? rect.y + rect.height * 0.28
      : rect.y + rect.height * 0.3;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();
  ctx.translate(translateX, translateY);
  ctx.globalAlpha = state.opacity;
  ctx.fillStyle = keyPointGradient(ctx, rect, placement);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = Math.max(2, Math.round(minSide * 0.006));
  drawStaggeredKeyPointLine(
    ctx,
    resolved.title,
    locale,
    anchorX,
    startY,
    align,
    `800 ${titleSize}px system-ui, sans-serif`,
    state.lines[0] ?? [],
  );
  let lineY = startY + titleSize + lineGap;
  resolved.bullets.slice(0, resolved.kind === 'chapter_drawer' ? 2 : 3).forEach((bullet, bulletIndex) => {
    drawStaggeredKeyPointLine(
      ctx,
      bullet,
      locale,
      anchorX,
      lineY,
      align,
      `700 ${bodySize}px system-ui, sans-serif`,
      state.lines[bulletIndex + 1] ?? [],
    );
    lineY += bodySize + lineGap;
  });
  ctx.restore();
}
