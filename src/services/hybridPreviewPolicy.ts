export type HybridPreviewMode = 'original' | 'proxy';

const LONG_PROJECT_THRESHOLD_MS = 45 * 60 * 1000;

export function resolveHybridPreviewMode(input: {
  durationMs: number;
  playing: boolean;
  preciseSeek: boolean;
  proxyReady?: boolean;
}): HybridPreviewMode {
  if (!input.proxyReady && input.proxyReady !== undefined) return 'original';
  if (input.durationMs < LONG_PROJECT_THRESHOLD_MS) return 'original';
  if (!input.playing || input.preciseSeek) return 'original';
  return 'proxy';
}

export function shouldBuildPreviewProxy(input: {
  durationMs: number;
  sourceBytes: number;
  sourceFps?: number;
}): boolean {
  return input.durationMs >= LONG_PROJECT_THRESHOLD_MS
    || input.sourceBytes >= 500 * 1024 * 1024
    || (input.durationMs >= 20 * 60 * 1000 && (input.sourceFps ?? 0) >= 50);
}

