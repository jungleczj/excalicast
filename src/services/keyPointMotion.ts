import type { KeyPointMotionSegment, SubtitleCue } from '@/types/recording';

export interface KeyPointMotionState {
  active: boolean;
  opacity: number;
  scale: number;
  translateY: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function resolveKeyPointMotionState(
  segment: KeyPointMotionSegment,
  timeMs: number,
): KeyPointMotionState {
  if (!segment.enabled || timeMs < segment.start || timeMs >= segment.end) {
    return { active: false, opacity: 0, scale: 0.96, translateY: 10 };
  }
  const duration = Math.max(1, segment.end - segment.start);
  const requested = Math.max(1, segment.transition.enterMs + segment.transition.exitMs);
  const transitionScale = Math.min(1, duration / requested);
  const enterMs = Math.max(1, segment.transition.enterMs * transitionScale);
  const exitMs = Math.max(1, segment.transition.exitMs * transitionScale);
  const enter = easeInOutCubic((timeMs - segment.start) / enterMs);
  const exit = easeInOutCubic((segment.end - timeMs) / exitMs);
  const opacity = Math.min(enter, exit);
  return {
    active: true,
    opacity,
    scale: 0.96 + opacity * 0.04,
    translateY: 10 * (1 - opacity),
  };
}

export function keyPointMotionAt(
  segments: KeyPointMotionSegment[] | undefined,
  timeMs: number,
): KeyPointMotionSegment | null {
  if (!segments?.length) return null;
  return segments.find((segment) => segment.enabled && timeMs >= segment.start && timeMs < segment.end) ?? null;
}

export function buildLocalKeyPointMotions(
  cues: SubtitleCue[],
  durationMs: number,
  locale: 'en' | 'zh',
): KeyPointMotionSegment[] {
  const clean = cues
    .filter((cue) => cue.text.trim() && cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!clean.length || durationMs <= 0) return [];

  const candidates = clean.filter((cue, index) => (
    index === 0
    || cue.startMs - clean[index - 1].endMs >= 1_200
    || index % 3 === 0
  ));
  const selected = candidates.length >= 2 ? candidates : clean.slice(0, Math.min(3, clean.length));

  return selected.slice(0, 8).map((cue, index) => {
    const start = Math.max(0, Math.min(durationMs - 800, cue.startMs));
    const end = Math.min(durationMs, Math.max(start + 1_600, Math.min(cue.endMs + 1_000, start + 3_800)));
    const title = compactText(cue.text, locale === 'zh' ? 22 : 48);
    return {
      id: `kp-local-${index}-${Math.round(start)}`,
      start,
      end,
      kind: index === 0 ? 'chapter_title' : (index % 2 === 0 ? 'lower_third' : 'side_card'),
      title,
      bullets: [],
      placement: 'auto',
      sourceCueStart: cue.index,
      sourceCueEnd: cue.index,
      transition: { enterMs: 320, exitMs: 260, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'local',
      schemaVersion: 1,
    } satisfies KeyPointMotionSegment;
  });
}
