import type { KeyPointMotionSegment, SubtitleCue } from '@/types/recording';
import { alignKeyPointMotionLines } from '@/services/keyPointMotion';

function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function shortPhrase(value: unknown, locale: 'en' | 'zh', kind: 'chapter' | 'point'): string {
  const clean = text(value, kind === 'chapter' ? 64 : 32).replace(/[。！？!?；;：:,，、]+$/u, '');
  if (!clean) return '';
  if (locale === 'en') {
    const words = clean.split(/\s+/).filter(Boolean);
    const maxWords = kind === 'chapter' ? 6 : 4;
    return words.length >= 1 && words.length <= maxWords && clean.length <= (kind === 'chapter' ? 48 : 28) ? clean : '';
  }
  const hanCount = Array.from(clean.replace(/[^\p{Script=Han}]/gu, '')).length;
  const max = kind === 'chapter' ? 8 : 5;
  return hanCount >= 2 && hanCount <= max ? clean : '';
}

function cueRange(cues: SubtitleCue[], startIndex: number, endIndex: number): { start: number; end: number } | null {
  const selected = cues.filter((cue) => cue.index >= startIndex && cue.index <= endIndex && cue.endMs > cue.startMs);
  if (!selected.length) return null;
  return { start: selected[0].startMs, end: selected[selected.length - 1].endMs };
}

interface AnchoredPhrase {
  text: string;
  anchorCueIndex: number;
}

function anchoredPhrases(values: unknown, locale: 'en' | 'zh', fallbackCueIndex: number): AnchoredPhrase[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: AnchoredPhrase[] = [];
  for (const value of values) {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    const phrase = shortPhrase(row?.text ?? value, locale, 'point');
    const key = phrase.toLocaleLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    result.push({
      text: phrase,
      anchorCueIndex: Math.max(0, Math.round(number(row?.anchorCueIndex, fallbackCueIndex))),
    });
    if (result.length === 4) break;
  }
  return result;
}

function cueEnd(cues: SubtitleCue[], cueIndex: number, fallback: number): number {
  return cues.find((cue) => cue.index === cueIndex)?.endMs ?? fallback;
}

function motionTiming(lines: NonNullable<KeyPointMotionSegment['lines']>, cues: SubtitleCue[], durationMs: number) {
  const firstReveal = Math.min(...lines.map((line) => line.revealAtMs));
  const lastReveal = Math.max(...lines.map((line) => line.revealAtMs));
  const lastCueEnd = Math.max(...lines.map((line) => cueEnd(cues, line.anchorCueIndex, line.revealAtMs)));
  return {
    start: Math.max(0, firstReveal - 150),
    end: Math.min(durationMs, Math.max(lastReveal + 800, lastCueEnd + 800)),
  };
}

export function parseKeyPointMotionResponse(
  raw: string,
  cues: SubtitleCue[],
  durationMs: number,
  locale: 'en' | 'zh',
): KeyPointMotionSegment[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('key_point_invalid_json'); }
  const rows = parsed && typeof parsed === 'object' && Array.isArray((parsed as { chapters?: unknown }).chapters)
    ? (parsed as { chapters: unknown[] }).chapters
    : [];
  const safeDuration = Math.max(0, durationMs);
  const seen = new Set<string>();
  const output: KeyPointMotionSegment[] = [];

  rows.slice(0, 8).forEach((candidate, chapterIndex) => {
    if (!candidate || typeof candidate !== 'object') return;
    const row = candidate as Record<string, unknown>;
    const title = shortPhrase(row.title, locale, 'chapter');
    const dedupeKey = title.toLocaleLowerCase();
    if (!title || seen.has(dedupeKey)) return;
    const startCue = Math.max(0, Math.round(number(row.startCueIndex, 0)));
    const endCue = Math.max(startCue, Math.round(number(row.endCueIndex, startCue)));
    const range = cueRange(cues, startCue, endCue);
    if (!range) return;
    const placement = row.placement === 'left' || row.placement === 'right' || row.placement === 'top' || row.placement === 'bottom'
      ? row.placement
      : 'auto';
    const titleAnchorCueIndex = Math.max(startCue, Math.min(endCue, Math.round(number(row.titleAnchorCueIndex, startCue))));
    const openingPoints = anchoredPhrases(row.openingPoints, locale, startCue)
      .filter((phrase) => phrase.text.toLocaleLowerCase() !== dedupeKey)
      .slice(0, 2);
    const chapterId = `kp-ai-chapter-${chapterIndex}-${range.start}`;
    const lines = alignKeyPointMotionLines({
      segmentId: chapterId,
      drafts: [
        { role: 'title', text: title, anchorCueIndex: titleAnchorCueIndex },
        ...openingPoints.map((point) => ({ role: 'point' as const, text: point.text, anchorCueIndex: point.anchorCueIndex })),
      ],
      cues,
      sourceCueStart: startCue,
      sourceCueEnd: endCue,
    });
    if (!lines.length) return;
    const timing = motionTiming(lines, cues, safeDuration);
    if (timing.end <= timing.start || timing.start >= safeDuration) return;
    seen.add(dedupeKey);
    output.push({
      id: chapterId,
      start: timing.start,
      end: timing.end,
      kind: 'chapter_drawer',
      title,
      bullets: openingPoints.map((point) => point.text),
      lines,
      placement,
      sourceCueStart: startCue,
      sourceCueEnd: endCue,
      transition: { enterMs: 280, exitMs: 420, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'deepseek',
      schemaVersion: 3,
    });

    const moments = Array.isArray(row.moments) ? row.moments : [];
    moments.slice(0, 4).forEach((candidateMoment, momentIndex) => {
      if (!candidateMoment || typeof candidateMoment !== 'object') return;
      const moment = candidateMoment as Record<string, unknown>;
      const momentStartCue = Math.max(startCue, Math.round(number(moment.startCueIndex, startCue)));
      const momentEndCue = Math.min(endCue, Math.max(momentStartCue, Math.round(number(moment.endCueIndex, momentStartCue))));
      const momentRange = cueRange(cues, momentStartCue, momentEndCue);
      const points = anchoredPhrases(moment.points, locale, momentStartCue);
      if (!momentRange || points.length === 0) return;
      const momentId = `kp-ai-point-${chapterIndex}-${momentIndex}-${momentRange.start}`;
      const momentLines = alignKeyPointMotionLines({
        segmentId: momentId,
        drafts: points.slice(0, 3).map((point, index) => ({
          role: index === 0 ? 'title' as const : 'point' as const,
          text: point.text,
          anchorCueIndex: point.anchorCueIndex,
        })),
        cues,
        sourceCueStart: momentStartCue,
        sourceCueEnd: momentEndCue,
      });
      if (!momentLines.length) return;
      const momentTiming = motionTiming(momentLines, cues, safeDuration);
      if (momentTiming.start >= safeDuration || momentTiming.end <= momentTiming.start) return;
      output.push({
        id: momentId,
        start: momentTiming.start,
        end: momentTiming.end,
        kind: 'key_points_drawer',
        title: points[0].text,
        bullets: points.slice(1, 3).map((point) => point.text),
        lines: momentLines,
        placement: moment.placement === 'left' || moment.placement === 'right' || moment.placement === 'top' || moment.placement === 'bottom'
          ? moment.placement
          : 'auto',
        sourceCueStart: momentStartCue,
        sourceCueEnd: momentEndCue,
        transition: { enterMs: 280, exitMs: 420, easing: 'easeInOutCubic' },
        enabled: true,
        generationSource: 'deepseek',
        schemaVersion: 3,
      });
    });
  });

  const sorted = output.sort((a, b) => a.start - b.start);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    sorted[index].end = Math.min(sorted[index].end, sorted[index + 1].start - 100);
  }
  return sorted.filter((motion) => motion.end > motion.start);
}
