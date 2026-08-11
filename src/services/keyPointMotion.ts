import type { KeyPointMotionSegment, SubtitleCue } from '@/types/recording';
import type { FrameRect } from '@/services/frameTransform';

export interface KeyPointMotionState {
  active: boolean;
  opacity: number;
  scale: number;
  translateY: number;
}

export interface KeyPointTokenState {
  opacity: number;
  translateY: number;
}

export interface KeyPointDrawerState {
  active: boolean;
  opacity: number;
  drawerProgress: number;
  drawerTranslateX: number;
  drawerTranslateY: number;
  tokens: KeyPointTokenState[];
}

export interface KeyPointDrawerLayout extends FrameRect {
  axis: 'horizontal' | 'vertical';
  edge: 'left' | 'right' | 'top' | 'bottom';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp01(value), 3);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

const EN_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'finally', 'first', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'then', 'this', 'to', 'we', 'with', 'you', 'your',
]);

function localShortPhrase(value: string, locale: 'en' | 'zh'): string {
  const clean = value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (locale === 'en') {
    const words = clean.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
    const meaningful = words.filter((word) => !EN_STOP_WORDS.has(word.toLocaleLowerCase()));
    const selected = (meaningful.length ? meaningful : words).slice(0, 4);
    while (selected.length > 1 && selected.join(' ').length > 28) selected.pop();
    return selected.join(' ').slice(0, 28).trim();
  }
  const han = Array.from(clean.replace(/[^\p{Script=Han}]/gu, '').replace(/^(首先|然后|最后|我们|这个|这里|需要|可以|就是)+/u, ''));
  return han.slice(0, 5).join('');
}

export function migrateKeyPointMotionSegment(segment: KeyPointMotionSegment): KeyPointMotionSegment {
  const kind = segment.kind === 'chapter_title' || segment.kind === 'chapter_drawer'
    ? 'chapter_drawer'
    : 'key_points_drawer';
  return {
    ...segment,
    kind,
    schemaVersion: 2,
    transition: {
      enterMs: Math.max(240, segment.transition?.enterMs ?? 600),
      exitMs: Math.max(180, segment.transition?.exitMs ?? 420),
      easing: 'easeInOutCubic',
    },
  };
}

export function tokenizeKeyPointLine(text: string, locale: 'en' | 'zh'): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (locale === 'en') return clean.split(' ').filter(Boolean);
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
    const words = Array.from(segmenter.segment(clean))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment);
    if (words.length > 0) return words;
  }
  return Array.from(clean);
}

export function resolveKeyPointDrawerLayout(
  bounds: FrameRect,
  placement: KeyPointMotionSegment['placement'],
): KeyPointDrawerLayout {
  const edge = placement === 'auto' ? 'right' : placement;
  if (edge === 'left' || edge === 'right') {
    const width = Math.round(bounds.width * 0.5);
    return {
      x: edge === 'right' ? bounds.x + bounds.width - width : bounds.x,
      y: bounds.y,
      width,
      height: bounds.height,
      axis: 'horizontal',
      edge,
    };
  }
  const height = Math.round(bounds.height * 0.45);
  return {
    x: bounds.x,
    y: edge === 'bottom' ? bounds.y + bounds.height - height : bounds.y,
    width: bounds.width,
    height,
    axis: 'vertical',
    edge,
  };
}

export function resolveKeyPointDrawerState(
  segment: KeyPointMotionSegment,
  timeMs: number,
  tokenCount: number,
): KeyPointDrawerState {
  if (!segment.enabled || timeMs < segment.start || timeMs >= segment.end) {
    return {
      active: false, opacity: 0, drawerProgress: 0,
      drawerTranslateX: 0, drawerTranslateY: 0,
      tokens: Array.from({ length: tokenCount }, () => ({ opacity: 0, translateY: 18 })),
    };
  }
  const duration = Math.max(1, segment.end - segment.start);
  const enterMs = Math.min(Math.max(240, segment.transition.enterMs), Math.max(240, duration * 0.45));
  const exitMs = Math.min(Math.max(180, segment.transition.exitMs), Math.max(180, duration * 0.35));
  const elapsed = timeMs - segment.start;
  const remaining = segment.end - timeMs;
  const enter = easeOutCubic(elapsed / enterMs);
  const exit = easeOutCubic(remaining / exitMs);
  const drawerProgress = Math.min(enter, exit);
  const placement = segment.placement === 'auto' ? 'right' : segment.placement;
  const signedOffset = 1 - drawerProgress;
  const drawerTranslateX = placement === 'right' ? signedOffset : placement === 'left' ? -signedOffset : 0;
  const drawerTranslateY = placement === 'bottom' ? signedOffset : placement === 'top' ? -signedOffset : 0;
  const tokenBaseTime = 70;
  const tokenDuration = 260;
  const tokenStagger = 62;
  const tokens = Array.from({ length: tokenCount }, (_, index) => {
    const tokenEnter = easeOutCubic((elapsed - tokenBaseTime - index * tokenStagger) / tokenDuration);
    const tokenOpacity = Math.min(tokenEnter, exit);
    return { opacity: tokenOpacity, translateY: (1 - tokenEnter) * 18 };
  });
  return { active: true, opacity: drawerProgress, drawerProgress, drawerTranslateX, drawerTranslateY, tokens };
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

  let nextAvailableStart = 0;
  return selected.slice(0, 8).map((cue, index) => {
    const start = Math.max(nextAvailableStart, Math.max(0, Math.min(durationMs - 800, cue.startMs)));
    const end = Math.min(durationMs, Math.max(start + 1_600, Math.min(cue.endMs + 1_000, start + 3_800)));
    nextAvailableStart = end;
    const title = localShortPhrase(cue.text, locale) || compactText(cue.text, locale === 'zh' ? 5 : 28);
    return {
      id: `kp-local-${index}-${Math.round(start)}`,
      start,
      end,
      kind: index === 0 ? 'chapter_drawer' : 'key_points_drawer',
      title,
      bullets: [],
      placement: 'auto',
      sourceCueStart: cue.index,
      sourceCueEnd: cue.index,
      transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'local',
      schemaVersion: 2,
    } satisfies KeyPointMotionSegment;
  }).filter((motion) => motion.end > motion.start);
}
