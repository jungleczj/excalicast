import type { KeyPointMotionSegment } from '@/types/recording';

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

export function parseKeyPointMotionResponse(raw: string, durationMs: number): KeyPointMotionSegment[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('key_point_invalid_json'); }
  const rows = parsed && typeof parsed === 'object' && Array.isArray((parsed as { motions?: unknown }).motions)
    ? (parsed as { motions: unknown[] }).motions
    : [];
  const safeDuration = Math.max(0, durationMs);
  const seen = new Set<string>();
  const output: KeyPointMotionSegment[] = [];

  rows.slice(0, 24).forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return;
    const row = candidate as Record<string, unknown>;
    const title = text(row.title, 120);
    const dedupeKey = title.toLocaleLowerCase();
    if (!title || seen.has(dedupeKey)) return;
    const start = Math.max(0, Math.min(safeDuration, Math.round(number(row.startMs, 0))));
    const end = Math.max(start + 100, Math.min(safeDuration, Math.round(number(row.endMs, start + 2_200))));
    if (end <= start || start >= safeDuration) return;
    const kind = row.kind === 'chapter_title' || row.kind === 'lower_third' || row.kind === 'side_card'
      ? row.kind
      : 'side_card';
    const placement = row.placement === 'left' || row.placement === 'right' || row.placement === 'top' || row.placement === 'bottom'
      ? row.placement
      : 'auto';
    const bullets = Array.isArray(row.bullets)
      ? row.bullets.map((value) => text(value, 160)).filter(Boolean).slice(0, 4)
      : [];
    seen.add(dedupeKey);
    output.push({
      id: `kp-ai-${index}-${start}`,
      start,
      end,
      kind,
      title,
      bullets,
      placement,
      sourceCueStart: Math.max(0, Math.round(number(row.sourceCueStart, 0))),
      sourceCueEnd: Math.max(0, Math.round(number(row.sourceCueEnd, 0))),
      transition: { enterMs: kind === 'chapter_title' ? 360 : 280, exitMs: 240, easing: 'easeInOutCubic' },
      enabled: true,
      generationSource: 'deepseek',
      schemaVersion: 1,
    });
  });

  return output.sort((a, b) => a.start - b.start);
}
