import type { KeyPointMotionLine, KeyPointMotionSegment, SubtitleCue } from '@/types/recording';
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
  lines: KeyPointTokenState[][];
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

interface KeyPointLineDraft {
  role: KeyPointMotionLine['role'];
  text: string;
  anchorCueIndex: number;
}

function matchText(value: string, locale: 'en' | 'zh'): string {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return locale === 'zh' ? normalized.replace(/\s+/g, '') : normalized.replace(/\s+/g, ' ');
}

function revealInsideCue(cue: SubtitleCue, position: number, textLength: number): number {
  const duration = Math.max(1, cue.endMs - cue.startMs);
  const edge = Math.min(80, Math.round(duration * 0.2));
  const interpolated = cue.startMs + Math.round(duration * clamp01(position / Math.max(1, textLength)));
  return Math.max(cue.startMs + edge, Math.min(cue.endMs - edge, interpolated));
}

export function alignKeyPointMotionLines(params: {
  segmentId: string;
  drafts: KeyPointLineDraft[];
  cues: SubtitleCue[];
  sourceCueStart: number;
  sourceCueEnd: number;
}): KeyPointMotionLine[] {
  const candidates = params.cues
    .filter((cue) => cue.index >= params.sourceCueStart && cue.index <= params.sourceCueEnd && cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!candidates.length) return [];
  const byIndex = new Map(candidates.map((cue) => [cue.index, cue]));
  let previousCueIndex: number | null = null;
  let previousReveal = -Infinity;

  return params.drafts.map((draft, lineIndex) => {
    const locale = /\p{Script=Han}/u.test(draft.text) ? 'zh' : 'en';
    const phrase = matchText(draft.text, locale);
    const requested = byIndex.get(draft.anchorCueIndex);
    let cue = requested ?? candidates[0];
    let matchKind: KeyPointMotionLine['matchKind'] = requested ? 'semantic' : 'fallback';
    let matchPosition = -1;

    const exactCandidates = candidates
      .map((candidate) => ({ candidate, position: matchText(candidate.text, locale).indexOf(phrase) }))
      .filter((entry) => phrase && entry.position >= 0)
      .sort((a, b) => {
        const requestedIndex = requested?.index ?? candidates[0].index;
        return Math.abs(a.candidate.index - requestedIndex) - Math.abs(b.candidate.index - requestedIndex)
          || a.candidate.startMs - b.candidate.startMs;
      });
    if (exactCandidates.length) {
      cue = exactCandidates[0].candidate;
      matchPosition = exactCandidates[0].position;
      matchKind = 'exact';
    } else if (phrase) {
      const terms = locale === 'zh'
        ? Array.from(phrase)
        : phrase.split(' ').filter((term) => term.length > 1);
      const partial = candidates
        .map((candidate) => {
          const candidateText = matchText(candidate.text, locale);
          const matchingTerms = terms.filter((term) => candidateText.includes(term));
          const firstPosition = matchingTerms.reduce((position, term) => {
            const next = candidateText.indexOf(term);
            return position < 0 || (next >= 0 && next < position) ? next : position;
          }, -1);
          return {
            candidate,
            candidateText,
            matchCount: matchingTerms.length,
            score: matchingTerms.length / Math.max(1, terms.length),
            firstPosition,
          };
        })
        .filter((entry) => entry.score > 0 && (locale === 'en' || entry.matchCount >= Math.min(2, terms.length)))
        .sort((a, b) => b.score - a.score || Math.abs(a.candidate.index - draft.anchorCueIndex) - Math.abs(b.candidate.index - draft.anchorCueIndex));
      if (partial.length) {
        cue = partial[0].candidate;
        matchPosition = partial[0].firstPosition;
        matchKind = 'partial';
      }
    }

    const cueText = matchText(cue.text, locale);
    const duration = Math.max(1, cue.endMs - cue.startMs);
    let revealAtMs = matchPosition >= 0
      ? revealInsideCue(cue, matchPosition, cueText.length)
      : cue.startMs + Math.min(320, Math.max(80, Math.round(duration * 0.18)));
    if (cue.index === previousCueIndex && revealAtMs < previousReveal + 180) {
      revealAtMs = Math.min(cue.endMs + 320, previousReveal + 180);
    }
    previousCueIndex = cue.index;
    previousReveal = revealAtMs;
    return {
      id: `${params.segmentId}-line-${lineIndex}`,
      role: draft.role,
      text: draft.text,
      anchorCueIndex: cue.index,
      revealAtMs,
      matchKind,
    };
  });
}

export function migrateKeyPointMotionSegment(segment: KeyPointMotionSegment, cues?: SubtitleCue[]): KeyPointMotionSegment {
  const kind = segment.kind === 'chapter_title' || segment.kind === 'chapter_drawer'
    ? 'chapter_drawer'
    : 'key_points_drawer';
  const texts = [segment.title, ...segment.bullets].filter(Boolean);
  const existing = segment.lines ?? [];
  const drafts = texts.map((lineText, index) => ({
    role: index === 0 ? 'title' as const : 'point' as const,
    text: lineText,
    anchorCueIndex: existing[index]?.anchorCueIndex ?? segment.sourceCueStart,
  }));
  const aligned = cues?.length
    ? alignKeyPointMotionLines({
        segmentId: segment.id,
        drafts,
        cues,
        sourceCueStart: segment.sourceCueStart,
        sourceCueEnd: segment.sourceCueEnd,
      })
    : drafts.map((draft, index) => ({
        id: existing[index]?.id ?? `${segment.id}-line-${index}`,
        ...draft,
        revealAtMs: existing[index]?.revealAtMs ?? segment.start + 150 + index * 180,
        matchKind: existing[index]?.matchKind ?? 'fallback' as const,
      }));
  return {
    ...segment,
    kind,
    lines: aligned,
    schemaVersion: 3,
    transition: {
      enterMs: segment.schemaVersion === 3 ? Math.max(240, segment.transition?.enterMs ?? 280) : 280,
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
  lineTokenCounts: number[] | number,
): KeyPointDrawerState {
  const counts = Array.isArray(lineTokenCounts) ? lineTokenCounts : [lineTokenCounts];
  const emptyLines = counts.map((count) => Array.from({ length: count }, () => ({ opacity: 0, translateY: 18 })));
  if (!segment.enabled || timeMs < segment.start || timeMs >= segment.end) {
    return {
      active: false, opacity: 0, drawerProgress: 0,
      drawerTranslateX: 0, drawerTranslateY: 0,
      lines: emptyLines,
      tokens: emptyLines.flat(),
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
  const tokenDuration = 260;
  const tokenStagger = 70;
  const revealLines = segment.lines ?? [];
  const lines = counts.map((count, lineIndex) => {
    const lineStart = revealLines[lineIndex]?.revealAtMs ?? segment.start + 150 + lineIndex * 180;
    const lineElapsed = timeMs - lineStart;
    return Array.from({ length: count }, (_, tokenIndex) => {
      const tokenEnter = easeOutCubic((lineElapsed - tokenIndex * tokenStagger) / tokenDuration);
      const tokenOpacity = Math.min(tokenEnter, exit);
      return { opacity: tokenOpacity, translateY: (1 - tokenEnter) * 18 };
    });
  });
  return { active: true, opacity: drawerProgress, drawerProgress, drawerTranslateX, drawerTranslateY, lines, tokens: lines.flat() };
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

  const motions: KeyPointMotionSegment[] = [];
  selected.slice(0, 8).forEach((cue, index) => {
    const title = localShortPhrase(cue.text, locale) || compactText(cue.text, locale === 'zh' ? 5 : 28);
    const id = `kp-local-${index}-${Math.round(cue.startMs)}`;
    const lines = alignKeyPointMotionLines({
      segmentId: id,
      drafts: [{ role: 'title', text: title, anchorCueIndex: cue.index }],
      cues: clean,
      sourceCueStart: cue.index,
      sourceCueEnd: cue.index,
    });
    if (!lines.length) return;
    const start = Math.max(0, lines[0].revealAtMs - 150);
    const end = Math.min(durationMs, Math.max(lines[0].revealAtMs + 800, cue.endMs + 800));
    if (end <= start || (motions.length > 0 && start < motions[motions.length - 1].end + 100)) return;
    motions.push({
      id,
      start,
      end,
      kind: index === 0 ? 'chapter_drawer' : 'key_points_drawer',
      title,
      bullets: [],
      lines,
      placement: 'auto',
      sourceCueStart: cue.index,
      sourceCueEnd: cue.index,
      transition: { enterMs: 280, exitMs: 420, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'local',
      schemaVersion: 3,
    });
  });
  return motions;
}
