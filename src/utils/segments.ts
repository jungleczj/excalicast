import type { TimeSegment } from '@/types/recording';

/**
 * 时间轴「保留段」工具：导出页 / 导出管线 / 预览播放共用。
 *
 * 约定：segments = 按时间排序、互不重叠的保留区间（ms，相对录制开始）。
 * 输出（成片）时间 = 各保留段长度累加后的连续时间轴；源时间 = 录制原始时间。
 */

/**
 * 规整保留段：钳到 [0,dur]、丢空段、按 start 排序、合并重叠/相邻段。
 * 缺省 / 空 / 覆盖全段 → 返回整段 `[{0,dur}]`（= 不裁）。
 */
export function normalizeSegments(segments: TimeSegment[] | undefined, durationMs: number): TimeSegment[] {
  const dur = Math.max(0, durationMs);
  if (dur === 0) return [{ start: 0, end: 0 }];
  if (!segments || segments.length === 0) return [{ start: 0, end: dur }];

  const clamped = segments
    .map((s) => ({
      start: Math.max(0, Math.min(dur, Math.min(s.start, s.end))),
      end: Math.max(0, Math.min(dur, Math.max(s.start, s.end))),
    }))
    .filter((s) => s.end - s.start >= 1)
    .sort((a, b) => a.start - b.start);
  if (clamped.length === 0) return [{ start: 0, end: dur }];

  const merged: TimeSegment[] = [{ ...clamped[0] }];
  for (let i = 1; i < clamped.length; i++) {
    const last = merged[merged.length - 1];
    if (clamped[i].start <= last.end) last.end = Math.max(last.end, clamped[i].end);
    else merged.push({ ...clamped[i] });
  }
  return merged;
}

/** 从保留段里挖掉源区间 [a,b]（框选删除）。可能把一段切成两段 / 截短 / 整段删除。 */
export function subtractRange(segments: TimeSegment[], a: number, b: number): TimeSegment[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < 1) return segments;
  const out: TimeSegment[] = [];
  for (const s of segments) {
    if (hi <= s.start || lo >= s.end) { out.push(s); continue; } // 无交集
    if (lo > s.start) out.push({ start: s.start, end: Math.min(lo, s.end) }); // 左残段
    if (hi < s.end) out.push({ start: Math.max(hi, s.start), end: s.end });   // 右残段
    // 否则被完全覆盖 → 丢弃
  }
  return out.filter((s) => s.end - s.start >= 1);
}

/** 保留段总时长（= 成片输出时长）。 */
export function keptDuration(segments: TimeSegment[]): number {
  return segments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
}

/** 最小片段时长（ms）：避免拆出/裁出过短片段。 */
export const MIN_SEGMENT_MS = 200;

/**
 * 在源时间 t 处把「包含 t 的片段」切成两段（剃刀/Split）。
 * 仅当 t 严格落在某段内、且两侧都 ≥ MIN 时才切；否则原样返回。
 */
export function splitSegments(segments: TimeSegment[], t: number): TimeSegment[] {
  const out: TimeSegment[] = [];
  let didSplit = false;
  for (const s of segments) {
    if (!didSplit && t > s.start + MIN_SEGMENT_MS && t < s.end - MIN_SEGMENT_MS) {
      out.push({ start: s.start, end: t }, { start: t, end: s.end });
      didSplit = true;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** 删除第 i 个片段（ripple：后续段自然接上）。至少保留 1 段。 */
export function removeSegmentAt(segments: TimeSegment[], i: number): TimeSegment[] {
  if (segments.length <= 1 || i < 0 || i >= segments.length) return segments;
  return segments.filter((_, idx) => idx !== i);
}

/** 拖动第 i 段的某端到源时间 t，钳到相邻段与最小长度内（Trim 手柄）。 */
export function trimSegmentEdge(
  segments: TimeSegment[], i: number, side: 'start' | 'end', t: number,
): TimeSegment[] {
  if (i < 0 || i >= segments.length) return segments;
  const out = segments.map((s) => ({ ...s }));
  const seg = out[i];
  if (side === 'start') {
    const lo = i > 0 ? out[i - 1].end : 0;
    seg.start = Math.max(lo, Math.min(t, seg.end - MIN_SEGMENT_MS));
  } else {
    const hi = i < out.length - 1 ? out[i + 1].start : Number.POSITIVE_INFINITY;
    seg.end = Math.min(hi, Math.max(t, seg.start + MIN_SEGMENT_MS));
  }
  return out;
}

/** segments 是否真的裁过（非「整段」）。 */
export function isTrimmed(segments: TimeSegment[], durationMs: number): boolean {
  return !(segments.length === 1 && segments[0].start <= 0 && segments[0].end >= durationMs);
}

/** 输出（成片）时间 → 源时间。outMs ∈ [0, keptDuration]。 */
export function outputToSource(segments: TimeSegment[], outMs: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (outMs <= acc + len) return s.start + (outMs - acc);
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
}

/**
 * 源时间 → 输出（成片）时间。
 * 若 srcMs 落在被删 gap 里，返回下一个保留段开头的输出时间（向前吸附）。
 */
export function sourceToOutput(segments: TimeSegment[], srcMs: number): number {
  let acc = 0;
  for (const s of segments) {
    if (srcMs < s.start) return acc;          // 在该段之前的 gap → 吸附到该段输出起点
    if (srcMs <= s.end) return acc + (srcMs - s.start);
    acc += s.end - s.start;
  }
  return acc; // 超过最后一段 → keptDuration
}
