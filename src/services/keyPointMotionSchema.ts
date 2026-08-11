import type { KeyPointMotionSegment, SubtitleCue } from '@/types/recording';

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

function uniquePhrases(values: unknown, locale: 'en' | 'zh'): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const phrase = shortPhrase(value, locale, 'point');
    const key = phrase.toLocaleLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    result.push(phrase);
    if (result.length === 4) break;
  }
  return result;
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
    const start = Math.max(0, Math.min(safeDuration, range.start));
    const end = Math.min(safeDuration, Math.max(start + 1_800, Math.min(range.end, start + 3_800)));
    if (end <= start || start >= safeDuration) return;
    const placement = row.placement === 'left' || row.placement === 'right' || row.placement === 'top' || row.placement === 'bottom'
      ? row.placement
      : 'auto';
    const bullets = uniquePhrases(row.openingPoints, locale).filter((phrase) => phrase.toLocaleLowerCase() !== dedupeKey).slice(0, 2);
    seen.add(dedupeKey);
    output.push({
      id: `kp-ai-chapter-${chapterIndex}-${start}`,
      start,
      end,
      kind: 'chapter_drawer',
      title,
      bullets,
      placement,
      sourceCueStart: startCue,
      sourceCueEnd: endCue,
      transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'deepseek',
      schemaVersion: 2,
    });

    const moments = Array.isArray(row.moments) ? row.moments : [];
    let nextMomentStart = end + 100;
    moments.slice(0, 4).forEach((candidateMoment, momentIndex) => {
      if (!candidateMoment || typeof candidateMoment !== 'object') return;
      const moment = candidateMoment as Record<string, unknown>;
      const momentStartCue = Math.max(startCue, Math.round(number(moment.startCueIndex, startCue)));
      const momentEndCue = Math.min(endCue, Math.max(momentStartCue, Math.round(number(moment.endCueIndex, momentStartCue))));
      const momentRange = cueRange(cues, momentStartCue, momentEndCue);
      const points = uniquePhrases(moment.points, locale);
      if (!momentRange || points.length === 0) return;
      const momentStart = Math.max(nextMomentStart, momentRange.start);
      const momentEnd = Math.min(safeDuration, Math.max(momentStart + 1_800, Math.min(momentRange.end + 800, momentStart + 3_800)));
      if (momentStart >= safeDuration || momentEnd <= momentStart) return;
      output.push({
        id: `kp-ai-point-${chapterIndex}-${momentIndex}-${momentStart}`,
        start: momentStart,
        end: momentEnd,
        kind: 'key_points_drawer',
        title: points[0],
        bullets: points.slice(1),
        placement: moment.placement === 'left' || moment.placement === 'right' || moment.placement === 'top' || moment.placement === 'bottom'
          ? moment.placement
          : 'auto',
        sourceCueStart: momentStartCue,
        sourceCueEnd: momentEndCue,
        transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic' },
        enabled: true,
        generationSource: 'deepseek',
        schemaVersion: 2,
      });
      nextMomentStart = momentEnd + 100;
    });
  });

  return output.sort((a, b) => a.start - b.start);
}
