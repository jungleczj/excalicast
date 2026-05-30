import 'server-only';

import type { WhiteboardSnapshot } from '@/types/recording';

/**
 * Handout / outline 生成服务端。
 *
 * 输入：snapshots（事件流）+ 字幕 SRT（可空）+ durationMs
 * 输出：{ chapters, markdown } —— 由 Deepseek 给出结构化结果。
 */

export interface HandoutChapter {
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
}

/** AI 从字幕里识别的"值得配图的关键时刻"（强调/操作指示处），客户端据此截图。 */
export interface HandoutKeyframe {
  timeMs: number;
  label: string;
}

export interface HandoutResult {
  title: string;
  chapters: HandoutChapter[];
  keyframes: HandoutKeyframe[];
  markdown: string;
}

const MAX_KEYFRAMES = 8;

// ---------------------------------------------------------------------------
// 1) Board summary —— 从 snapshots 抽出"有意思的事件"
// ---------------------------------------------------------------------------

interface SimpleElement {
  id?: string;
  type?: string;
  text?: string;
  isDeleted?: boolean;
}

/**
 * 遍历 snapshots，产出紧凑的事件文本：
 *  - 首次出现的元素（按 element.id 去重）：`[t=12.3s] new <type> "<text?>"`
 *  - 约每 N 秒采样一帧元素总数变化
 * 输出按字数 cap 在 ~30KB 内。
 */
export function extractBoardSummary(
  snapshots: WhiteboardSnapshot[],
  durationMs: number,
): string {
  if (snapshots.length === 0) return '';
  const seenIds = new Set<string>();
  const lines: string[] = [];
  let budget = 30_000;
  const fmt = (ms: number) => `[t=${(ms / 1000).toFixed(1)}s]`;
  for (const snap of snapshots) {
    if (budget < 200) break;
    const elements = (snap.elements as SimpleElement[]) ?? [];
    for (const el of elements) {
      if (!el || el.isDeleted) continue;
      const id = el.id ?? '';
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const type = el.type ?? 'element';
      const txt = (el.text ?? '').trim().slice(0, 80);
      const line = txt
        ? `${fmt(snap.timestamp)} new ${type} "${txt}"`
        : `${fmt(snap.timestamp)} new ${type}`;
      lines.push(line);
      budget -= line.length + 1;
      if (budget < 200) break;
    }
  }
  // 末尾追加 duration
  lines.push(`[total duration ${(durationMs / 1000).toFixed(1)}s, ${snapshots.length} snapshots]`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2) Prompt 构造
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `你是一名中文/英文双语技术文档编辑。基于一段白板录制的事件流和语音字幕，
生成结构化讲义（outline + Markdown）。语言保持与字幕主要语言一致。
严格按 JSON schema 输出：
{
  "title": "讲义标题",
  "chapters": [
    { "startMs": 0, "endMs": 60000, "title": "章节标题", "summary": "200 字以内摘要" }
  ],
  "keyframes": [
    { "timeMs": 32000, "label": "一句话说明这一处为什么是关键点" }
  ],
  "markdown": "# 标题\\n\\n## 章节标题\\n\\n章节正文..."
}
要求：
- 3-7 个章节，时间区间互不重叠且按时间顺序排列；
- 每章 summary 200 字以内；
- keyframes：仅在字幕中出现"强调或操作指示"语义的位置挑选（例如"这里是重点 / 注意 / 需要关注 / 这里怎么操作 / 关键在于 / 记住 / 第一步…"等），**不是每章都要**，没有这类表达就少给或不给；最多 8 个；timeMs 必须落在录制时长内、尽量对齐字幕时间戳；label 用一句话点明该处看点。无字幕时 keyframes 返回空数组 []。
- markdown 包含完整讲义（标题 + 章节正文 + 关键要点）；
- 直接返回 JSON，不要添加任何额外说明或 markdown 围栏。`;

export function buildHandoutPrompt(params: {
  subtitleSrt: string | null;
  boardSummary: string;
  durationMs: number;
}): string {
  const subtitleSection = (params.subtitleSrt ?? '').trim()
    ? `## 字幕（含时间戳）\n${params.subtitleSrt}`
    : `## 字幕\n(无字幕)`;
  const boardSection = params.boardSummary
    ? `## 事件流\n${params.boardSummary}`
    : `## 事件流\n(无事件)`;
  return `${subtitleSection}\n\n${boardSection}\n\n## 任务\n请基于以上材料按 schema 输出讲义 JSON。`;
}

// ---------------------------------------------------------------------------
// 3) 解析 + 校验 Deepseek 返回
// ---------------------------------------------------------------------------

export function parseHandoutJson(text: string, durationMs: number): HandoutResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 兜底：模型可能加了 markdown 围栏，剥一下再试
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('handout_parse_no_json');
    raw = JSON.parse(m[0]);
  }

  if (!raw || typeof raw !== 'object') throw new Error('handout_parse_not_object');
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title : '讲义';
  const markdown = typeof obj.markdown === 'string' ? obj.markdown : '';
  if (!markdown) throw new Error('handout_parse_missing_markdown');

  const chapters: HandoutChapter[] = [];
  const rawChapters = Array.isArray(obj.chapters) ? obj.chapters : [];
  for (const c of rawChapters) {
    if (!c || typeof c !== 'object') continue;
    const ch = c as Record<string, unknown>;
    const startMs = typeof ch.startMs === 'number' ? ch.startMs : Number(ch.startMs);
    const endMs = typeof ch.endMs === 'number' ? ch.endMs : Number(ch.endMs);
    if (!isFinite(startMs) || !isFinite(endMs)) continue;
    chapters.push({
      startMs: Math.max(0, Math.min(durationMs, startMs)),
      endMs: Math.max(0, Math.min(durationMs, endMs)),
      title: typeof ch.title === 'string' ? ch.title : '',
      summary: typeof ch.summary === 'string' ? ch.summary : '',
    });
  }
  // 至少给一个空章节，避免下游空数组渲染问题
  if (chapters.length === 0) {
    chapters.push({ startMs: 0, endMs: durationMs, title, summary: '' });
  }

  // keyframes：AI 挑的关键时刻（可空），clamp 到时长内、按时间排序、去重、限量
  const keyframes: HandoutKeyframe[] = [];
  const rawKeyframes = Array.isArray(obj.keyframes) ? obj.keyframes : [];
  const seenMs = new Set<number>();
  for (const k of rawKeyframes) {
    if (!k || typeof k !== 'object') continue;
    const kf = k as Record<string, unknown>;
    const timeMsNum = typeof kf.timeMs === 'number' ? kf.timeMs : Number(kf.timeMs);
    if (!isFinite(timeMsNum)) continue;
    const timeMs = Math.max(0, Math.min(durationMs, Math.round(timeMsNum)));
    if (seenMs.has(timeMs)) continue;
    seenMs.add(timeMs);
    keyframes.push({ timeMs, label: typeof kf.label === 'string' ? kf.label.slice(0, 120) : '' });
  }
  keyframes.sort((a, b) => a.timeMs - b.timeMs);

  return { title, chapters, keyframes: keyframes.slice(0, MAX_KEYFRAMES), markdown };
}
