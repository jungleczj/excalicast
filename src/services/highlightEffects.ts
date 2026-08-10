import type { HighlightEffectSegment } from '@/types/recording';

export interface HighlightFrameState {
  active: boolean;
  phase: 'inactive' | 'enter' | 'hold' | 'exit';
  aperture: { x: number; y: number; width: number; height: number };
  maskOpacity: number;
  focusProgress: number;
  haloOpacity: number;
  haloScale: number;
  calloutOpacity: number;
  calloutOffset: number;
}

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function phaseProgress(progress: number, start: number, end: number): number {
  return easeInOutCubic(clamp01((progress - start) / Math.max(0.001, end - start)));
}

function effectiveTransitions(segment: HighlightEffectSegment): { enterMs: number; exitMs: number } {
  const duration = Math.max(1, segment.end - segment.start);
  const requested = Math.max(1, segment.transition.enterMs + segment.transition.exitMs);
  const scale = Math.min(1, duration / requested);
  return {
    enterMs: Math.max(1, segment.transition.enterMs * scale),
    exitMs: Math.max(1, segment.transition.exitMs * scale),
  };
}

export function highlightAt(
  segments: HighlightEffectSegment[] | undefined,
  timeMs: number,
): HighlightEffectSegment | null {
  if (!segments?.length) return null;
  return segments.find((segment) => timeMs >= segment.start && timeMs < segment.end) ?? null;
}

export function resolveHighlightFrameState(
  segment: HighlightEffectSegment,
  timeMs: number,
): HighlightFrameState {
  if (timeMs < segment.start || timeMs >= segment.end) {
    return {
      active: false,
      phase: 'inactive',
      aperture: FULL_FRAME,
      maskOpacity: 0,
      focusProgress: 0,
      haloOpacity: 0,
      haloScale: 0.82,
      calloutOpacity: 0,
      calloutOffset: 8,
    };
  }

  const transitions = effectiveTransitions(segment);
  const enterEnd = segment.start + transitions.enterMs;
  const exitStart = segment.end - transitions.exitMs;
  let surroundProgress = 1;
  let phase: HighlightFrameState['phase'] = 'hold';
  let sequenceProgress = 1;

  if (timeMs < enterEnd) {
    phase = 'enter';
    sequenceProgress = clamp01((timeMs - segment.start) / transitions.enterMs);
    surroundProgress = easeInOutCubic(sequenceProgress);
  } else if (timeMs > exitStart) {
    phase = 'exit';
    sequenceProgress = clamp01((segment.end - timeMs) / transitions.exitMs);
    surroundProgress = easeInOutCubic(sequenceProgress);
  }

  const region = segment.region;
  const aperture = phase === 'hold'
    ? { ...region }
    : {
        x: lerp(0, region.x, surroundProgress),
        y: lerp(0, region.y, surroundProgress),
        width: lerp(1, region.width, surroundProgress),
        height: lerp(1, region.height, surroundProgress),
      };
  const focusProgress = segment.enabled.focusFrame ? phaseProgress(sequenceProgress, 0.35, 0.78) : 0;
  const haloOpacity = segment.enabled.cursorHalo ? phaseProgress(sequenceProgress, 0.55, 0.85) : 0;
  const calloutOpacity = segment.enabled.textCallout ? phaseProgress(sequenceProgress, 0.7, 1) : 0;

  return {
    active: true,
    phase,
    aperture,
    maskOpacity: segment.enabled.spotlight ? clamp01(segment.spotlightOpacity) * surroundProgress : 0,
    focusProgress,
    haloOpacity,
    haloScale: 0.82 + 0.18 * haloOpacity,
    calloutOpacity,
    calloutOffset: 8 * (1 - calloutOpacity),
  };
}
