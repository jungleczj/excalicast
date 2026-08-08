export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameZoom {
  scale: number;
  cx?: number;
  cy?: number;
}

export function resolveFrameTransform(input: {
  bounds: FrameRect;
  zoom?: FrameZoom | null;
}): { source: FrameRect; destination: FrameRect } {
  const bounds = {
    x: input.bounds.x,
    y: input.bounds.y,
    width: Math.max(1, input.bounds.width),
    height: Math.max(1, input.bounds.height),
  };
  const scale = Math.max(1, Math.min(4, input.zoom?.scale ?? 1));
  const width = bounds.width / scale;
  const height = bounds.height / scale;
  const focusX = bounds.x + Math.max(0, Math.min(1, input.zoom?.cx ?? 0.5)) * bounds.width;
  const focusY = bounds.y + Math.max(0, Math.min(1, input.zoom?.cy ?? 0.5)) * bounds.height;
  const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, focusX - width / 2));
  const y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - height, focusY - height / 2));
  return {
    source: { x, y, width, height },
    destination: bounds,
  };
}
