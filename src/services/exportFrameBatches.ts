export interface ExportFrameBatch {
  start: number;
  endExclusive: number;
}

export function planExportFrameBatches(
  totalFrames: number,
  fps: number,
  secondsPerBatch = 10,
): ExportFrameBatch[] {
  const total = Math.max(0, Math.floor(totalFrames));
  const size = Math.max(1, Math.floor(fps * secondsPerBatch));
  const batches: ExportFrameBatch[] = [];
  for (let start = 0; start < total; start += size) {
    batches.push({ start, endExclusive: Math.min(total, start + size) });
  }
  return batches;
}
