import type { SubtitleCue } from '@/types/recording';

// ---------------------------------------------------------------------------
// 口水词词表（分组，便于增删）。仅做第 1、2 档，保守不动「就是/那个/then/like」等可能有实义的词。
// ---------------------------------------------------------------------------

// 第 1 档 · 纯迟疑音：无词汇意义，任意位置都删（含重复/叠字）。
// 中文：呃 嗯 唔 呣（及连写）；英文：um/uh/uhm/erm/er/hmm/mm/mhm（及叠写）。
const TIER1_CJK = /[呃嗯唔呣]+/gu;
const TIER1_EN = /\b(?:u+m+|u+h+|uh+m+|e+rm+|er|h+m+|mm+|mhm)\b/gi;

// 第 2 档 · 语气词/感叹词：仅当作"独立 token"（被空白/标点/首尾包裹）时删，避免误删句中实义用法。
// 用前导分隔符捕获组 + 后向断言（不使用后向否定 lookbehind，兼容旧 Safari）。
const SEP = '\\s，,。．.、！？!?；;：:…';
const TIER2_CJK = new RegExp(`(^|[${SEP}])[啊哦噢喔唉诶欸呢嘛哈额哼]+(?=$|[${SEP}])`, 'gu');
const TIER2_EN = /\b(?:ah+|eh+|oh+|huh|hah)\b/gi;

/**
 * 字幕文本清洗（显示与导出共用，单点处理，不改存储的原始 SRT）：
 *  - 去口水词（第 1 档全局迟疑音 + 第 2 档独立语气词，中英）
 *  - 清理残留的多余空格/重复标点 + 去句末标点
 * 整段被清空（纯口水词/标点）时返回 ''，调用方据此跳过该 cue。
 */
export function cleanSubtitleText(raw: string): string {
  let s = raw.trim();

  // 第 1 档：全局删迟疑音
  s = s.replace(TIER1_CJK, '').replace(TIER1_EN, '');

  // 第 2 档：独立语气词（反复跑两遍，处理「啊，哦，」相邻两个的情况）
  for (let i = 0; i < 2; i++) {
    s = s.replace(TIER2_CJK, '$1').replace(TIER2_EN, '');
  }

  // 清理：英文多余空格、重复标点、标点前的多余空格、逗号紧接句末标点
  s = s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，,。．.、！？!?；;：:])/gu, '$1')
    .replace(/([，,。．.、！？!?；;：:])\1+/gu, '$1')
    .replace(/[，,、]+([。．.！？!?])/gu, '$1');

  // 去首尾标点/空白
  s = s.replace(/^[\s，,。．.、！？!?；;：:…]+/u, '');
  s = s.replace(/[。．.!！?？…,，;；、:：\s]+$/u, '');
  return s.trim();
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
