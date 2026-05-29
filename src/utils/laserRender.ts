import type { LaserEvent } from '@/types/recording';

interface DrawOpts {
  /** 一段 stroke 从最新点开始到完全淡出的毫秒数。Excalidraw 自家默认 1000ms。 */
  decayMs?: number;
  /** 把 scene 坐标变换到目标 canvas 像素坐标。 */
  sceneToScreen: (x: number, y: number) => { x: number; y: number };
  /** 默认 Excalidraw 自家的激光红。 */
  strokeColor?: string;
  /** 最大线宽（淡入起点）。 */
  maxLineWidth?: number;
}

/**
 * 在目标 canvas 2D context 上画"当前帧"应该可见的激光轨迹。
 *
 *  - 用二分查截取 (timeMs - decayMs, timeMs] 窗口内的所有事件
 *  - 按 button=='down' 序列分段（一笔 = 连续 down 段；'up' 是分段标记）
 *  - 每一笔画一条 polyline；整段 alpha = 1 - (timeMs - lastPointTs)/decayMs
 *
 * events 必须按 timestamp 升序传入；外部调用 sortBy('timestamp') 已保证。
 *
 * 性能：导出 30fps 时每帧 ~30 个事件需扫描，整段计算 < 1ms。
 */
export function drawLaserOverlay(
  ctx: CanvasRenderingContext2D,
  events: readonly LaserEvent[],
  timeMs: number,
  opts: DrawOpts,
): void {
  if (events.length === 0) return;
  const decay = opts.decayMs ?? 1000;
  const minT = timeMs - decay;
  if (minT >= events[events.length - 1].timestamp) return;

  // 找窗口起点：二分查第一个 timestamp > minT 的下标
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timestamp > minT) hi = mid;
    else lo = mid + 1;
  }
  const startIdx = lo;
  if (startIdx >= events.length) return;

  // 按 button 分段：用 'up' 作为段尾标记，下一段从下一个事件起
  const segments: LaserEvent[][] = [];
  let current: LaserEvent[] = [];
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i];
    if (e.timestamp > timeMs) break;
    current.push(e);
    if (e.button === 'up') {
      if (current.length >= 1) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 1) segments.push(current);
  if (segments.length === 0) return;

  const strokeColor = opts.strokeColor ?? '#fd2c41';
  const maxWidth = opts.maxLineWidth ?? 4;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeColor;

  for (const seg of segments) {
    if (seg.length === 0) continue;
    const lastTs = seg[seg.length - 1].timestamp;
    const age = Math.max(0, timeMs - lastTs);
    const alpha = Math.max(0, 1 - age / decay);
    if (alpha <= 0.01) continue;

    ctx.globalAlpha = alpha;
    ctx.lineWidth = maxWidth;
    ctx.beginPath();
    for (let i = 0; i < seg.length; i++) {
      const p = opts.sceneToScreen(seg[i].x, seg[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.restore();
}
