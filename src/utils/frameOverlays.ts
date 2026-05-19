import { cueAt, parseSrt } from '@/utils/srtParser';
import type { SubtitleCue } from '@/types/recording';

export function compileSubtitles(srt: string | null | undefined): SubtitleCue[] {
  return srt ? parseSrt(srt) : [];
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    // For CJK + Latin mix: greedy by character so it works for Chinese too.
    let current = '';
    for (const ch of paragraph) {
      const trial = current + ch;
      const w = ctx.measureText(trial).width;
      if (w > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = trial;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

export function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  videoW: number,
  videoH: number,
  cues: SubtitleCue[],
  timeMs: number,
  options?: { reservedRightFraction?: number },
): void {
  if (cues.length === 0) return;
  const cue = cueAt(cues, timeMs);
  if (!cue) return;

  const fontSize = Math.max(18, Math.round(videoH * 0.034));
  const lineHeight = Math.round(fontSize * 1.35);
  const padX = Math.round(fontSize * 0.75);
  const padY = Math.round(fontSize * 0.45);
  // 摄像头气泡在右下角时为字幕预留出空间，避免被遮住
  const usableFraction = 1 - (options?.reservedRightFraction ?? 0);
  const maxTextWidth = Math.round(videoW * 0.84 * usableFraction);

  ctx.save();
  ctx.font = `600 ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif`;
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, cue.text, maxTextWidth);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const textBlockH = lines.length * lineHeight - (lineHeight - fontSize);
  const blockH = textBlockH + padY * 2;

  // 测最大行宽以决定背景框宽度
  let maxLineW = 0;
  for (const l of lines) {
    const w = ctx.measureText(l).width;
    if (w > maxLineW) maxLineW = w;
  }
  const blockW = Math.min(videoW * 0.92, maxLineW + padX * 2);

  // 底部 8% 高度的位置
  const cx = videoW / 2;
  const blockBottom = videoH - Math.round(videoH * 0.06);
  const blockTop = blockBottom - blockH;
  const blockX = cx - blockW / 2;

  // 圆角矩形背景
  const radius = Math.round(fontSize * 0.4);
  ctx.beginPath();
  ctx.moveTo(blockX + radius, blockTop);
  ctx.lineTo(blockX + blockW - radius, blockTop);
  ctx.quadraticCurveTo(blockX + blockW, blockTop, blockX + blockW, blockTop + radius);
  ctx.lineTo(blockX + blockW, blockTop + blockH - radius);
  ctx.quadraticCurveTo(blockX + blockW, blockTop + blockH, blockX + blockW - radius, blockTop + blockH);
  ctx.lineTo(blockX + radius, blockTop + blockH);
  ctx.quadraticCurveTo(blockX, blockTop + blockH, blockX, blockTop + blockH - radius);
  ctx.lineTo(blockX, blockTop + radius);
  ctx.quadraticCurveTo(blockX, blockTop, blockX + radius, blockTop);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fill();

  // 文字
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  let y = blockTop + padY;
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += lineHeight;
  }

  ctx.restore();
}

/**
 * 豆包风格毛玻璃水印 "excalicast.cc"。
 * 思路：把目标区域的像素拷到离屏 canvas 模糊后贴回，再叠白雾 + 描边 + 文字。
 * 与静态 PNG overlay 的区别：背景模糊来自当前帧真实内容。
 */
export function drawFrostedWatermark(
  ctx: CanvasRenderingContext2D,
  videoW: number,
  videoH: number,
  position: 'bottom-right' | 'bottom-left',
): void {
  const text = 'excalicast.cc';
  const fontSize = Math.max(14, Math.round(videoH * 0.022));
  const padX = Math.round(fontSize * 0.95);
  const padY = Math.round(fontSize * 0.5);
  const marginX = Math.round(videoW * 0.022);
  const marginY = Math.round(videoH * 0.038);

  // 先测文字宽决定方框尺寸
  ctx.save();
  ctx.font = `600 ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(text).width;
  ctx.restore();

  const boxW = Math.round(textW + padX * 2);
  const boxH = Math.round(fontSize + padY * 2);
  const boxX = position === 'bottom-right' ? videoW - boxW - marginX : marginX;
  const boxY = videoH - boxH - marginY;
  const radius = Math.round(fontSize * 0.55);

  // 1) 从目标 canvas 抠出对应区域 → 用 filter='blur(...)' 重画放大一点边界避免边缘问题
  const blurRadius = Math.max(6, Math.round(fontSize * 0.55));
  const srcCanvas = ctx.canvas;
  const offscreen = document.createElement('canvas');
  offscreen.width = boxW;
  offscreen.height = boxH;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    // 模糊版的源像素
    // 先 drawImage 把对应区域贴上，再 filter='blur' 重画自己
    offCtx.drawImage(
      srcCanvas,
      boxX, boxY, boxW, boxH,
      0, 0, boxW, boxH,
    );
    // 取出像素再用 filter='blur' 二次绘制到自己上
    const blurredCanvas = document.createElement('canvas');
    blurredCanvas.width = boxW;
    blurredCanvas.height = boxH;
    const blurCtx = blurredCanvas.getContext('2d');
    if (blurCtx) {
      blurCtx.filter = `blur(${blurRadius}px)`;
      blurCtx.drawImage(offscreen, 0, 0);
      blurCtx.filter = 'none';

      // 2) 在目标 canvas 上以圆角 clip 贴回模糊版
      ctx.save();
      ctx.beginPath();
      roundRectPath(ctx, boxX, boxY, boxW, boxH, radius);
      ctx.clip();
      ctx.drawImage(blurredCanvas, boxX, boxY);

      // 3) 白雾层
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.restore();
    }
  }

  // 4) 圆角描边（高光感）
  ctx.save();
  roundRectPath(ctx, boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1, radius);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 5) 文字
  ctx.save();
  ctx.font = `600 ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // 阴影（提高深色画面的对比度）
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(text, boxX + boxW / 2, boxY + boxH / 2);
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
