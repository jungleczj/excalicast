import type { SubtitleCue } from '@/types/recording';

function parseTimestamp(ts: string): number {
  // "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
  const m = ts.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0').slice(0, 3));
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

export function parseSrt(srt: string): SubtitleCue[] {
  if (!srt) return [];
  const text = srt.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l).filter((l, i) => !(i === 0 && /^#/.test(l)));
    if (lines.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const tsLine = lines[idx];
    const arrow = tsLine.split('-->');
    if (arrow.length !== 2) continue;
    const startMs = parseTimestamp(arrow[0]);
    const endMs = parseTimestamp(arrow[1]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const body = lines.slice(idx + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ index: cues.length + 1, startMs, endMs, text: body });
  }
  return cues;
}

export function cueAt(cues: SubtitleCue[], ms: number): SubtitleCue | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startMs <= ms) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans === -1) return null;
  const c = cues[ans];
  if (c.endMs < ms) return null;
  return c;
}
