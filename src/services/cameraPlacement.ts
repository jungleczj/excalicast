import type { CameraPlacementV2, CameraPositionEvent } from '@/types/recording';

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function captureCameraPlacement(input: {
  contentRect: RectLike;
  bubbleRect: RectLike;
  edgeThresholdPx?: number;
}): CameraPlacementV2 {
  const { contentRect, bubbleRect } = input;
  const threshold = Math.max(0, input.edgeThresholdPx ?? 12);
  const safeWidth = Math.max(1, contentRect.width);
  const safeHeight = Math.max(1, contentRect.height);
  const shortSide = Math.max(1, Math.min(safeWidth, safeHeight));
  const leftInset = bubbleRect.x - contentRect.x;
  const rightInset = contentRect.x + safeWidth - (bubbleRect.x + bubbleRect.width);
  const topInset = bubbleRect.y - contentRect.y;
  const bottomInset = contentRect.y + safeHeight - (bubbleRect.y + bubbleRect.height);

  return {
    version: 2,
    coordinateSpace: 'selected-content',
    cx: clamp01((bubbleRect.x + bubbleRect.width / 2 - contentRect.x) / safeWidth),
    cy: clamp01((bubbleRect.y + bubbleRect.height / 2 - contentRect.y) / safeHeight),
    size: Math.max(0, bubbleRect.width / shortSide),
    anchorX: leftInset <= threshold ? 'left' : rightInset <= threshold ? 'right' : 'free',
    anchorY: topInset <= threshold ? 'top' : bottomInset <= threshold ? 'bottom' : 'free',
    edgeInsetX: Math.max(0, (leftInset <= threshold ? leftInset : rightInset) / safeWidth),
    edgeInsetY: Math.max(0, (topInset <= threshold ? topInset : bottomInset) / safeHeight),
  };
}

export function projectCameraPlacement(
  placement: CameraPlacementV2,
  contentRect: RectLike,
): { x: number; y: number; size: number } {
  const width = Math.max(1, contentRect.width);
  const height = Math.max(1, contentRect.height);
  const size = Math.min(Math.min(width, height), Math.max(1, placement.size * Math.min(width, height)));
  let x = contentRect.x + placement.cx * width - size / 2;
  let y = contentRect.y + placement.cy * height - size / 2;

  if (placement.anchorX === 'left') x = contentRect.x + placement.edgeInsetX * width;
  if (placement.anchorX === 'right') x = contentRect.x + width - placement.edgeInsetX * width - size;
  if (placement.anchorY === 'top') y = contentRect.y + placement.edgeInsetY * height;
  if (placement.anchorY === 'bottom') y = contentRect.y + height - placement.edgeInsetY * height - size;

  return {
    x: Math.max(contentRect.x, Math.min(contentRect.x + width - size, x)),
    y: Math.max(contentRect.y, Math.min(contentRect.y + height - size, y)),
    size,
  };
}

export function cameraPlacementFromEvent(event: CameraPositionEvent): CameraPlacementV2 {
  if (event.placement?.version === 2) return event.placement;
  return {
    version: 2,
    coordinateSpace: 'selected-content',
    cx: clamp01(event.rx + event.rs / 2),
    cy: clamp01(event.ry + event.rs / 2),
    size: Math.max(0, event.rs),
    anchorX: 'free',
    anchorY: 'free',
    edgeInsetX: 0,
    edgeInsetY: 0,
  };
}
