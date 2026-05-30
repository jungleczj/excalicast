import type { SubtitleCue } from '@/types/recording';

// 独立语气词/口水词（仅去开头或整段，避免误删句中有意义的词如「就是/那个」）
const FILLER_RE = /^(?:嗯+|呃+|啊+|哦+|唉+|呐+|嗯呐|um+|uh+|erm+|er+)(?:[，,。．.、\s]+|$)/i;

/**
 * 字幕文本清洗（显示与导出共用，单点处理，不改存储的原始 SRT）：
 *  - 去句末标点（。．.！？!?…，,；;、 等）
 *  - 去开头/整段的语气词口水词（保守）
 */
export function cleanSubtitleText(raw: string): string {
  let s = raw.trim();
  // 反复剥离开头语气词（如「嗯，那个…」剥一次「嗯，」）
  let prev: string;
  do {
    prev = s;
    s = s.replace(FILLER_RE, '').trim();
  } while (s !== prev && s.length > 0);
  // 去句末标点（含全角/半角）
  s = s.replace(/[。．.!！?？…,，;；、\s]+$/u, '').trim();
  return s;
}

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
    const text = cleanSubtitleText(body);
    if (!text) continue; // 清洗后为空（纯口水词/标点）则跳过
    cues.push({ index: cues.length + 1, startMs, endMs, text });
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
