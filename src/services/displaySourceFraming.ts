import type { SourceCropWindow } from '@/types/recording';

export interface SourcePreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FitSourcePreviewOptions {
  viewportWidth: number;
  viewportHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clean(value: number): number {
  return Number(value.toFixed(4));
}

export function fitSourcePreview(options: FitSourcePreviewOptions): SourcePreviewRect {
  const viewportWidth = Math.max(1, options.viewportWidth);
  const viewportHeight = Math.max(1, options.viewportHeight);
  const sourceWidth = Math.max(1, options.sourceWidth);
  const sourceHeight = Math.max(1, options.sourceHeight);
  const zoom = Math.max(0.1, options.zoom);
  const fitScale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const width = sourceWidth * fitScale * zoom;
  const height = sourceHeight * fitScale * zoom;
  return {
    x: clean((viewportWidth - width) / 2 + options.panX),
    y: clean((viewportHeight - height) / 2 + options.panY),
    width: clean(width),
    height: clean(height),
  };
}

export function viewportPointToSource(
  point: { x: number; y: number },
  preview: SourcePreviewRect,
): { x: number; y: number } {
  return {
    x: clean(clamp01((point.x - preview.x) / Math.max(1, preview.width))),
    y: clean(clamp01((point.y - preview.y) / Math.max(1, preview.height))),
  };
}

export function cropToViewportRect(
  crop: SourceCropWindow,
  preview: SourcePreviewRect,
): SourcePreviewRect {
  return {
    x: clean(preview.x + crop.rx * preview.width),
    y: clean(preview.y + crop.ry * preview.height),
    width: clean(crop.rw * preview.width),
    height: clean(crop.rh * preview.height),
  };
}
