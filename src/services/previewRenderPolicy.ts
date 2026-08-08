export interface PreviewRenderSizeInput {
  compositionWidth: number;
  compositionHeight: number;
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
  maxEdge?: number;
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Keep preview work proportional to visible pixels; export keeps its full size. */
export function resolvePreviewRenderSize(input: PreviewRenderSizeInput): { width: number; height: number } {
  const compositionWidth = Math.max(2, input.compositionWidth);
  const compositionHeight = Math.max(2, input.compositionHeight);
  const maxEdge = Math.max(480, input.maxEdge ?? 1440);
  const dpr = Math.max(1, Math.min(2, input.devicePixelRatio || 1));
  const hasDisplaySize = input.displayWidth > 0 && input.displayHeight > 0;
  const requestedWidth = hasDisplaySize ? input.displayWidth * dpr : compositionWidth;
  const requestedHeight = hasDisplaySize ? input.displayHeight * dpr : compositionHeight;
  const scale = Math.min(
    1,
    requestedWidth / compositionWidth,
    requestedHeight / compositionHeight,
    maxEdge / Math.max(compositionWidth, compositionHeight),
  );
  return {
    width: even(compositionWidth * scale),
    height: even(compositionHeight * scale),
  };
}
