'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { getCursorFocusTrack, getLocalizedTrack, getWorkspaceShells, loadFullRecording } from '@/lib/db-client';
import {
  cropRectForAspect,
  cropRectForSnapshot,
  computeContentBoundingBox,
  viewportFromAppState,
  DEFAULT_FALLBACK_VIEWPORT,
  type CropContext,
} from '@/services/cropping';
import {
  ASPECT_PRESETS,
  RESOLUTION_SCALE,
  resolveExportOutputSize,
  type CameraPositionEvent,
  type CameraShape,
  type AutoZoomSegment,
  type CroppingMode,
  type ExportConfig,
  type ExportFormat,
  type ExportQuality,
  type RecordingSourceKind,
  type RecordingMetadata,
  type SceneRect,
  type SourceCropWindow,
  type TimeSegment,
  type VideoBackgroundConfig,
  type WhiteboardSnapshot,
  type WorkspaceShellRow,
} from '@/types/recording';
import { compileSubtitles, drawFrostedWatermark, drawSubtitle, subtitleLayout, chunkByWidth, subtitlePageIndex } from '@/utils/frameOverlays';
import { normalizeSegments, keptDuration, isTrimmed, outputToSource } from '@/utils/segments';
import { cueAt } from '@/utils/srtParser';
import { createCameraFrameSource, type CameraFrameSource } from './webmCameraFrames';
import { drawLaserOverlay } from '@/utils/laserRender';
import { paintVideoBackground } from '@/services/videoBackgroundRenderer';
import { createDisplayFrameSource, createSeekableDisplayFrameSource, type DisplayFrameSource } from '@/services/displayFrameSource';
import {
  createCursorFocusExportAnalyzer,
  cursorFocusSourceSignature,
  focusedCoverPlacement,
  focusPointAt,
  type CursorFocusExportAnalyzer,
} from '@/services/cursorFocusTracker';
import { createExportDiagnostics } from '@/services/exportDiagnostics';
import { planExportFrameBatches } from '@/services/exportFrameBatches';
import { createDisplayBlurWorker } from '@/services/displayBlurWorker';
import { cameraPlacementFromEvent, projectCameraPlacement } from '@/services/cameraPlacement';
import type { ExportDiagnosticReport, ExportProgressDetails } from '@/types/exportDiagnostics';
import { previewPlaybackRegistry } from '@/services/previewPlaybackRegistry';
import { resolveFrameTransform } from '@/services/frameTransform';

export interface ExportOptions extends ExportConfig {
  recordingId: string;
  onPhase?: (phase: string) => void;
  onProgress?: (ratio: number) => void;
  onLog?: (message: string) => void;
  onProgressDetails?: (details: ExportProgressDetails) => void;
  onDiagnostics?: (report: ExportDiagnosticReport) => void;
  signal?: AbortSignal;
}

let _ffmpeg: FFmpeg | null = null;
const previewDisplayCache = new Map<string, { source: DisplayFrameSource; lastTimeMs: number }>();

const previewShellCache = new Map<string, Promise<DecodedShell[]>>();

async function getFfmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

export function cancelActiveExport(): void {
  try { _ffmpeg?.terminate(); } catch { /* best effort */ }
  _ffmpeg = null;
}

async function remuxEncodedVideoWithAudio(
  videoBlob: Blob,
  audioBlob: Blob,
  format: 'mp4' | 'webm',
  segments: TimeSegment[] | undefined,
  onLog?: (message: string) => void,
): Promise<Blob> {
  const ffmpeg = await getFfmpeg(onLog);
  const videoName = format === 'webm' ? '__fast_video.webm' : '__fast_video.mp4';
  const outputName = format === 'webm' ? '__fast_output.webm' : '__fast_output.mp4';
  const audioName = '__fast_audio.webm';
  try {
    await ffmpeg.writeFile(videoName, new Uint8Array(await videoBlob.arrayBuffer()));
    await ffmpeg.writeFile(audioName, new Uint8Array(await audioBlob.arrayBuffer()));

    const args = ['-i', videoName, '-i', audioName];
    if (segments && segments.length > 0) {
      const filters: string[] = [];
      const labels: string[] = [];
      segments.forEach((segment, index) => {
        const label = `__fast_a${index}`;
        filters.push(
          `[1:a]atrim=start=${(segment.start / 1000).toFixed(3)}:end=${(segment.end / 1000).toFixed(3)},asetpts=PTS-STARTPTS[${label}]`,
        );
        labels.push(`[${label}]`);
      });
      if (labels.length > 1) filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[__fast_aout]`);
      args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', labels.length > 1 ? '[__fast_aout]' : labels[0]);
    } else {
      args.push('-map', '0:v', '-map', '1:a');
    }
    args.push('-c:v', 'copy');
    if (format === 'webm') args.push('-c:a', 'libopus');
    else args.push('-c:a', 'aac');
    args.push('-shortest', outputName);

    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new Blob([buffer], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });
  } finally {
    for (const name of [videoName, audioName, outputName]) {
      try { await ffmpeg.deleteFile(name); } catch { /* best effort */ }
    }
  }
}

async function getPreviewDisplaySource(recordingId: string, screenBlob: Blob, timeMs: number): Promise<DisplayFrameSource> {
  const cached = previewDisplayCache.get(recordingId);
  if (cached && timeMs >= cached.lastTimeMs - 80) {
    cached.lastTimeMs = Math.max(cached.lastTimeMs, timeMs);
    return cached.source;
  }
  if (cached) {
    try { cached.source.close(); } catch { /* ignore */ }
    previewDisplayCache.delete(recordingId);
  }
  // Preview must support arbitrary backward/forward seeks. The sequential WebCodecs
  // source is reserved for export, where timestamps are monotonic.
  const source = createSeekableDisplayFrameSource(screenBlob);
  previewDisplayCache.set(recordingId, { source, lastTimeMs: timeMs });
  await previewPlaybackRegistry.attach(recordingId, source);
  return source;
}

function snapshotAt(snapshots: WhiteboardSnapshot[], t: number): WhiteboardSnapshot | null {
  if (snapshots.length === 0) return null;
  let lo = 0, hi = snapshots.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].timestamp <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans === -1 ? snapshots[0] : snapshots[ans];
}

/**
 * 找到 timeMs 时刻的摄像头位置事件（≤ 当前 timestamp 的最后一个）。
 * 没有事件时返回 null —— 调用方应回退到默认右下角。
 * 命中事件带 hidden=true 时一并透传，调用方应不渲染气泡。
 */
export function cameraPositionAt(
  events: CameraPositionEvent[],
  timeMs: number,
): CameraPositionEvent | null {
  if (events.length === 0) return null;
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timestamp <= timeMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  const e = events[ans === -1 ? 0 : ans];
  return { ...e, hidden: !!e.hidden };
}

export interface CameraSegment {
  startMs: number;
  endMs: number;
  x: number;      // overlay 像素位置（output 分辨率）
  y: number;
  size: number;   // 边长（output 像素）
}

/**
 * 摄像头气泡在输出画幅里的"有效边界"——shell off 就是整个 target，
 * shell on 时是 letterbox 之后 shell 占据的矩形。
 * 气泡的 rx/ry/rs 都相对这个边界（不再相对整个 target），所以 letterbox
 * 之后气泡跟着 shell 一起缩放、位移，不会漂到留白上。
 */
export interface CameraBounds {
  offX: number;
  offY: number;
  w: number;
  h: number;
}

/**
 * 把按时间排序的事件流转成 ffmpeg overlay 用的"区间"序列：
 *  - 区间 i = [events[i].timestamp, events[i+1]?.timestamp ?? durationMs]
 *  - 折叠像素相同的相邻区间（少量抖动 → 一段）
 *  - 丢掉短于 50ms 的区间（不到一帧）
 *  - 区间数超过 maxSegments 时按移动距离阈值再次合并（避免 ffmpeg 过滤链爆炸）
 *
 *  - bounds：气泡定位的有效边界（见 CameraBounds 注释）。shell off 时传
 *    `{ offX:0, offY:0, w:outputW, h:outputH }` 等价于旧行为。
 */
export function buildCameraSegments(
  events: CameraPositionEvent[],
  durationMs: number,
  bounds: CameraBounds,
  maxSegments = 150,
): CameraSegment[] {
  if (events.length === 0 || durationMs <= 0) return [];
  // 1) 朴素铺开区间。hidden=true 的事件不生成 overlay segment——它把"从此刻起到下一个非
  //    hidden 事件之间"的区间从结果里挖掉，ffmpeg 自然就不会画气泡。
  const raw: CameraSegment[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].hidden) continue;
    const startMs = Math.max(0, events[i].timestamp);
    const endMs = i + 1 < events.length ? events[i + 1].timestamp : durationMs;
    if (endMs - startMs < 50) continue;
    // 尺寸按「有效边界较短边」归一（rs 存的也是相对裁切框较短边）→ 跨比例协调、竖屏不再过小。
    const projected = projectCameraPlacement(cameraPlacementFromEvent(events[i]), {
      x: bounds.offX, y: bounds.offY, width: bounds.w, height: bounds.h,
    });
    const size = Math.max(16, Math.round(projected.size));
    const x = Math.round(projected.x);
    const y = Math.round(projected.y);
    raw.push({ startMs, endMs, x, y, size });
  }
  if (raw.length === 0) return [];

  // 2) 合并相邻"像素相同"的段
  const coalesced: CameraSegment[] = [];
  for (const seg of raw) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.x === seg.x && last.y === seg.y && last.size === seg.size) {
      last.endMs = seg.endMs;
    } else {
      coalesced.push({ ...seg });
    }
  }

  // 3) 如果还超 cap，按 12px 阈值再合并
  if (coalesced.length <= maxSegments) return coalesced;
  const aggressive: CameraSegment[] = [coalesced[0]];
  for (let i = 1; i < coalesced.length; i++) {
    const last = aggressive[aggressive.length - 1];
    const seg = coalesced[i];
    const dx = Math.abs(last.x - seg.x);
    const dy = Math.abs(last.y - seg.y);
    const dz = Math.abs(last.size - seg.size);
    if (dx < 12 && dy < 12 && dz < 8) {
      last.endMs = seg.endMs;
    } else {
      aggressive.push({ ...seg });
    }
  }
  return aggressive.slice(0, maxSegments);
}

/** 在画布上把摄像头帧画成镜像气泡（与设置页、ffmpeg overlay 观感一致）。 */
function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  frame: { displayWidth?: number; displayHeight?: number; codedWidth?: number; codedHeight?: number },
  x: number, y: number, size: number, shape: CameraShape,
): void {
  const fw = frame.displayWidth ?? frame.codedWidth ?? size;
  const fh = frame.displayHeight ?? frame.codedHeight ?? size;
  const s = Math.min(fw, fh);            // cover-crop 成正方形
  const sx = (fw - s) / 2;
  const sy = (fh - s) / 2;
  ctx.save();
  if (shape === 'rounded') {
    roundedRectPath(ctx, { x, y, width: size, height: size }, Math.max(12, Math.round(size * 0.14)));
  } else {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
  }
  ctx.clip();
  ctx.translate(x + size, y);            // 水平镜像（hflip）
  ctx.scale(-1, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.drawImage(frame as any, sx, sy, s, s, 0, 0, size, size);
  ctx.restore();
}

function drawDisplayFrame(
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource & {
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
    codedWidth?: number;
    codedHeight?: number;
  },
  sourceKind: RecordingSourceKind,
  sourceCrop: SourceCropWindow | undefined,
  croppingMode: CroppingMode,
  targetW: number,
  targetH: number,
  insetScale = 1,
  focus?: { x: number; y: number },
): void {
  const vw = frame.videoWidth ?? frame.displayWidth ?? frame.codedWidth ?? targetW;
  const vh = frame.videoHeight ?? frame.displayHeight ?? frame.codedHeight ?? targetH;
  const effectiveCrop = sourceKind === 'selected_area' ? undefined : sourceCrop;
  const crop = effectiveCrop
    ? {
        sx: effectiveCrop.rx * vw,
        sy: effectiveCrop.ry * vh,
        sw: effectiveCrop.rw * vw,
        sh: effectiveCrop.rh * vh,
      }
    : { sx: 0, sy: 0, sw: vw, sh: vh };
  const focusSourceX = Math.max(crop.sx, Math.min(crop.sx + crop.sw, (focus?.x ?? 0.5) * vw));
  const focusSourceY = Math.max(crop.sy, Math.min(crop.sy + crop.sh, (focus?.y ?? 0.5) * vh));
  const relativeFocus = {
    x: (focusSourceX - crop.sx) / crop.sw,
    y: (focusSourceY - crop.sy) / crop.sh,
  };
  const placement = croppingMode === 'fit_all_content'
    ? (() => {
        const scale = Math.min((targetW * insetScale) / crop.sw, (targetH * insetScale) / crop.sh);
        const dw = crop.sw * scale;
        const dh = crop.sh * scale;
        return { scale, dw, dh, dx: (targetW - dw) / 2, dy: (targetH - dh) / 2 };
      })()
    : focusedCoverPlacement(crop.sw, crop.sh, targetW, targetH, relativeFocus);
  const { scale, dw, dh, dx, dy } = placement;
  if (croppingMode === 'fit_all_content') {
    const radius = Math.max(0, Math.round(Math.min(dw, dh) * 0.018));
    ctx.save();
    ctx.shadowColor = 'rgba(20, 25, 30, 0.24)';
    ctx.shadowBlur = Math.max(12, Math.round(Math.min(targetW, targetH) * 0.025));
    ctx.shadowOffsetY = Math.max(5, Math.round(targetH * 0.012));
    ctx.fillStyle = 'rgba(20, 25, 30, 0.16)';
    roundedRectPath(ctx, { x: dx, y: dy, width: dw, height: dh }, radius);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundedRectPath(ctx, { x: dx, y: dy, width: dw, height: dh }, radius);
    ctx.clip();
    ctx.drawImage(frame, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(frame, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, dw, dh);
}

function hasSelectedVideoBackground(background?: VideoBackgroundConfig): boolean {
  return !!background && background.kind !== 'none';
}

function paintDisplaySourceFallback(
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource & {
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
    codedWidth?: number;
    codedHeight?: number;
  },
  width: number,
  height: number,
  scratch?: { source: HTMLCanvasElement; blurred: HTMLCanvasElement },
): void {
  const sourceW = frame.videoWidth ?? frame.displayWidth ?? frame.codedWidth ?? width;
  const sourceH = frame.videoHeight ?? frame.displayHeight ?? frame.codedHeight ?? height;
  const scale = Math.max(width / sourceW, height / sourceH) * 1.06;
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  if (scratch) {
    const reducedW = Math.max(2, Math.ceil(width / 8));
    const reducedH = Math.max(2, Math.ceil(height / 8));
    for (const canvas of [scratch.source, scratch.blurred]) {
      if (canvas.width !== reducedW) canvas.width = reducedW;
      if (canvas.height !== reducedH) canvas.height = reducedH;
    }
    const reducedScale = Math.max(reducedW / sourceW, reducedH / sourceH) * 1.12;
    const reducedDrawW = sourceW * reducedScale;
    const reducedDrawH = sourceH * reducedScale;
    const sourceCtx = scratch.source.getContext('2d')!;
    sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceCtx.filter = 'none';
    sourceCtx.clearRect(0, 0, reducedW, reducedH);
    sourceCtx.drawImage(frame, (reducedW - reducedDrawW) / 2, (reducedH - reducedDrawH) / 2, reducedDrawW, reducedDrawH);
    const blurredCtx = scratch.blurred.getContext('2d')!;
    blurredCtx.setTransform(1, 0, 0, 1, 0, 0);
    blurredCtx.clearRect(0, 0, reducedW, reducedH);
    blurredCtx.filter = `blur(${Math.max(2, Math.round(Math.min(reducedW, reducedH) * 0.025))}px)`;
    blurredCtx.drawImage(scratch.source, 0, 0);
    blurredCtx.filter = 'none';
    // Keep an opaque cover below the blurred layer. Canvas blur samples outside
    // its source bounds as transparent; without this underlay the initial white
    // canvas leaks into portrait/ultrawide edges.
    ctx.drawImage(scratch.source, 0, 0, reducedW, reducedH, 0, 0, width, height);
    ctx.drawImage(scratch.blurred, 0, 0, reducedW, reducedH, 0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 253, 248, 0.14)';
    ctx.fillRect(0, 0, width, height);
    return;
  }
  ctx.drawImage(frame, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  ctx.save();
  ctx.filter = `blur(${Math.max(18, Math.round(Math.min(width, height) * 0.025))}px)`;
  ctx.drawImage(frame, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 253, 248, 0.14)';
  ctx.fillRect(0, 0, width, height);
}

/** Auto Zoom 在片段边缘使用对称缓动，避免倍率从 1 直接跳到目标值。 */
export function autoZoomAt(segments: AutoZoomSegment[] | undefined, t: number): AutoZoomSegment | null {
  if (!segments || segments.length === 0) return null;
  const segment = segments.find((z) => t >= z.start && t <= z.end && z.scale > 1);
  if (!segment) return null;

  const duration = Math.max(1, segment.end - segment.start);
  // 默认 2.2 秒的片段会以约 620ms 缓入/缓出；短片段按自身时长收缩，
  // 仍保持中间有可感知的停留区，而不是突然闪一下。
  const rampMs = Math.min(650, Math.max(180, duration * 0.28));
  const progress = Math.min(
    1,
    Math.max(0, Math.min((t - segment.start) / rampMs, (segment.end - t) / rampMs)),
  );
  // easeInOutCubic：开始和结束速度都接近 0，放大与恢复同样柔和。
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

  return {
    ...segment,
    scale: 1 + (Math.max(1, Math.min(4, segment.scale)) - 1) * eased,
  };
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 有视频背景时，录制画面作为一个固定的前景窗口置于背景上方。AutoZoom 只在这个
 * 窗口内部移动镜头；窗口本身、背景以及窗口之外的留白都不参与缩放。
 */
export interface RecordingWindowRect extends CanvasRect {
  radius: number;
  scale: number;
}

export function getRecordingWindowRect(
  width: number,
  height: number,
  background?: VideoBackgroundConfig,
): RecordingWindowRect | null {
  if (!background || background.kind === 'none') return null;
  // 保留足够的背景呼吸空间。统一缩放可确保前景画幅不被拉伸。
  const scale = 0.84;
  const windowWidth = Math.round(width * scale);
  const windowHeight = Math.round(height * scale);
  return {
    x: Math.round((width - windowWidth) / 2),
    y: Math.round((height - windowHeight) / 2),
    width: windowWidth,
    height: windowHeight,
    radius: Math.max(16, Math.round(Math.min(windowWidth, windowHeight) * 0.025)),
    scale,
  };
}

function appendRoundedRectPath(ctx: CanvasRenderingContext2D, rect: CanvasRect, radius: number): void {
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  ctx.moveTo(rect.x + r, rect.y);
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
  ctx.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r);
  ctx.closePath();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, rect: CanvasRect, radius: number): void {
  ctx.beginPath();
  appendRoundedRectPath(ctx, rect, radius);
}

function drawRecordingWindowShadow(
  target: CanvasRenderingContext2D,
  frame: RecordingWindowRect,
  color: string,
  blur: number,
  offsetY: number,
): void {
  target.save();
  // Restrict the fill to the exterior of the window. The rounded rectangle is
  // only a shadow caster; its center stays transparent so the wallpaper remains
  // continuous through letterboxed areas inside the fixed recording frame.
  target.beginPath();
  target.rect(0, 0, target.canvas.width, target.canvas.height);
  appendRoundedRectPath(target, frame, frame.radius);
  target.clip('evenodd');
  target.shadowColor = color;
  target.shadowBlur = blur;
  target.shadowOffsetY = offsetY;
  target.fillStyle = '#000000';
  roundedRectPath(target, frame, frame.radius);
  target.fill();
  target.restore();
}

function drawRecordingWindow(
  target: CanvasRenderingContext2D,
  foreground: HTMLCanvasElement,
  background?: VideoBackgroundConfig,
): void {
  const frame = getRecordingWindowRect(target.canvas.width, target.canvas.height, background);
  if (!frame) {
    target.drawImage(foreground, 0, 0);
    return;
  }

  // Draw decoration outside the window without placing an opaque card below
  // the source. Transparent contain margins therefore reveal the same wallpaper.
  drawRecordingWindowShadow(
    target,
    frame,
    'rgba(22, 27, 32, 0.25)',
    Math.max(28, Math.round(frame.width * 0.027)),
    Math.max(14, Math.round(frame.height * 0.025)),
  );
  drawRecordingWindowShadow(
    target,
    frame,
    'rgba(22, 27, 32, 0.13)',
    Math.max(8, Math.round(frame.width * 0.008)),
    Math.max(3, Math.round(frame.height * 0.005)),
  );

  target.save();
  roundedRectPath(target, frame, frame.radius);
  target.clip();
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = 'high';
  target.drawImage(foreground, 0, 0, foreground.width, foreground.height, frame.x, frame.y, frame.width, frame.height);
  target.restore();

  target.save();
  target.strokeStyle = 'rgba(31, 34, 37, 0.12)';
  target.lineWidth = Math.max(1, Math.round(Math.min(target.canvas.width, target.canvas.height) / 1200));
  roundedRectPath(target, frame, frame.radius);
  target.stroke();
  target.restore();
}

function projectBoundsIntoRecordingWindow(
  bounds: CameraBounds,
  outputWidth: number,
  outputHeight: number,
  background?: VideoBackgroundConfig,
): CameraBounds {
  const frame = getRecordingWindowRect(outputWidth, outputHeight, background);
  if (!frame) return bounds;
  return {
    offX: frame.x + bounds.offX * frame.scale,
    offY: frame.y + bounds.offY * frame.scale,
    w: bounds.w * frame.scale,
    h: bounds.h * frame.scale,
  };
}

/**
 * 背景与录制内容分层合成：AutoZoom 只能作用于透明的内容层，避免把用户选择的
 * 视频背景也一起裁切、放大。白板、工作区壳、屏幕录制和激光笔都属于内容层。
 */
function createContentLayer(width: number, height: number): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  return layer;
}

function drawZoomedContentLayer(
  target: CanvasRenderingContext2D,
  content: HTMLCanvasElement,
  zoom: AutoZoomSegment | null,
  bounds: CanvasRect = { x: 0, y: 0, width: content.width, height: content.height },
): void {
  target.drawImage(content, 0, 0);
  if (!zoom) return;
  const scale = Math.max(1, Math.min(4, zoom.scale));
  if (scale <= 1.0001) return;
  const safeBounds: CanvasRect = {
    x: Math.max(0, Math.min(content.width, bounds.x)),
    y: Math.max(0, Math.min(content.height, bounds.y)),
    width: Math.max(1, Math.min(content.width - Math.max(0, bounds.x), bounds.width)),
    height: Math.max(1, Math.min(content.height - Math.max(0, bounds.y), bounds.height)),
  };
  const transform = resolveFrameTransform({ bounds: safeBounds, zoom });
  target.save();
  target.beginPath();
  target.rect(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
  target.clip();
  target.clearRect(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = 'high';
  target.drawImage(
    content,
    transform.source.x,
    transform.source.y,
    transform.source.width,
    transform.source.height,
    transform.destination.x,
    transform.destination.y,
    transform.destination.width,
    transform.destination.height,
  );
  target.restore();
}

interface ShellLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  canvasRect: CanvasRect;
}

function shellLayout(shell: WorkspaceShellRow, targetWidth: number, targetHeight: number): ShellLayout {
  const scale = Math.min(targetWidth / shell.shellSize.width, targetHeight / shell.shellSize.height);
  const width = shell.shellSize.width * scale;
  const height = shell.shellSize.height * scale;
  const offsetX = (targetWidth - width) / 2;
  const offsetY = (targetHeight - height) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    canvasRect: {
      x: offsetX + shell.canvasRect.x * scale,
      y: offsetY + shell.canvasRect.y * scale,
      width: shell.canvasRect.width * scale,
      height: shell.canvasRect.height * scale,
    },
  };
}

function shellAt(shells: WorkspaceShellRow[], t: number): WorkspaceShellRow | null {
  if (shells.length === 0) return null;
  let lo = 0, hi = shells.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shells[mid].timestamp <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans === -1 ? shells[0] : shells[ans];
}

interface DecodedShell extends WorkspaceShellRow {
  bitmap: ImageBitmap;
}

async function decodeShells(rows: WorkspaceShellRow[]): Promise<DecodedShell[]> {
  const out: DecodedShell[] = [];
  for (const r of rows) {
    try {
      const bitmap = await createImageBitmap(r.png);
      out.push({ ...r, bitmap });
    } catch {
      // 跳过损坏的快照
    }
  }
  return out;
}

function disposeShells(decoded: DecodedShell[]): void {
  for (const s of decoded) {
    try { s.bitmap.close(); } catch { /* ignore */ }
  }
}

async function getPreviewShells(recordingId: string): Promise<DecodedShell[]> {
  const cached = previewShellCache.get(recordingId);
  if (cached) return cached;
  const pending = getWorkspaceShells(recordingId).then(decodeShells);
  previewShellCache.set(recordingId, pending);
  try {
    return await pending;
  } catch (error) {
    previewShellCache.delete(recordingId);
    throw error;
  }
}

export function releasePreviewResources(recordingId: string): void {
  const display = previewDisplayCache.get(recordingId);
  if (display) {
    try { display.source.close(); } catch { /* ignore */ }
    previewDisplayCache.delete(recordingId);
  }
  const shells = previewShellCache.get(recordingId);
  previewShellCache.delete(recordingId);
  previewPlaybackRegistry.clear(recordingId);
  void shells?.then(disposeShells).catch(() => undefined);
}

export async function setPreviewPlayback(recordingId: string, playing: boolean, timeMs: number): Promise<void> {
  previewPlaybackRegistry.setIntent(recordingId, playing, timeMs);
}

interface ElementBoxOnly { x: number; y: number; w: number; h: number }

function elementBoundsUnion(elements: unknown[]): SceneRect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const e of elements) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (r.isDeleted === true) continue;
    const x = Number(r.x), y = Number(r.y), w = Number(r.width), h = Number(r.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionRect(a: SceneRect, b: SceneRect): SceneRect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 在元素列表里追加一个 0 透明度的"哨兵矩形"，让 exportToCanvas 的 bbox 至少覆盖目标 crop rect。
 * Excalidraw 内部会把元素和 background 一并渲染到 commonBounds + padding 里。
 */
function buildGhostRect(crop: SceneRect): Record<string, unknown> {
  return {
    type: 'rectangle',
    id: `ghost-${crop.x.toFixed(0)}-${crop.y.toFixed(0)}-${Math.random().toString(36).slice(2, 8)}`,
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 0,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 0,
    groupIds: [],
    frameId: null,
    seed: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: null,
    roundness: null,
  };
}

export async function exportRecording(opts: ExportOptions): Promise<Blob> {
  const diagnostics = createExportDiagnostics({ recordingId: opts.recordingId, totalFrames: 0 });
  let diagnosticsCompleted = false;
  let releaseExportResources = () => {};
  let abortListener: (() => void) | null = null;
  let lastDetailsAt = 0;
  const checkCancelled = () => {
    if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  const emitDetails = (force = false) => {
    const now = performance.now();
    if (!force && now - lastDetailsAt < 120) return;
    lastDetailsAt = now;
    opts.onProgressDetails?.(diagnostics.snapshot());
  };
  const setPhase = (phase: string) => {
    diagnostics.setPhase(phase);
    opts.onPhase?.(phase);
    emitDetails(true);
  };
  const setProgress = (ratio: number) => {
    diagnostics.setProgress(ratio);
    opts.onProgress?.(ratio);
    emitDetails();
  };
  const completeDiagnostics = () => {
    if (diagnosticsCompleted) return;
    diagnosticsCompleted = true;
    const report = diagnostics.complete();
    opts.onProgressDetails?.(report);
    opts.onDiagnostics?.(report);
  };
  try {
  checkCancelled();
  const phaseStartedAt = performance.now();
  setPhase('loading_media');
  setProgress(0.01);
  setPhase('loading_renderer');
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  setProgress(0.03);
  setPhase('assembling_media');
  const { metadata, snapshots, audioBlob, cameraBlob, screenBlob, cameraEvents, laserEvents, binaryFiles, manifest } = await loadFullRecording(opts.recordingId);
  diagnostics.setMedia({ audio: manifest.audio, camera: manifest.camera, screen: manifest.screen });
  diagnostics.addBreakdown('media_loading', performance.now() - phaseStartedAt);
  setProgress(0.08);
  opts.onLog?.(`media manifest: audio=${manifest.audio.chunks} chunks/${manifest.audio.bytes} bytes, camera=${manifest.camera.chunks} chunks/${manifest.camera.bytes} bytes, screen=${manifest.screen.chunks} chunks/${manifest.screen.bytes} bytes`);
  opts.onLog?.(`media ready in ${Math.round(performance.now() - phaseStartedAt)}ms`);
  const localizedTrack = opts.localizedTrackId ? await getLocalizedTrack(opts.localizedTrackId) : undefined;
  const useLocalizedTrack = !!localizedTrack && opts.muteOriginalAudio !== false;
  const effectiveAudioBlob = useLocalizedTrack ? localizedTrack.audioBlob : audioBlob;
  const effectiveCameraBlob = useLocalizedTrack && localizedTrack.cameraBlob ? localizedTrack.cameraBlob : cameraBlob;
  const effectiveSubtitleSrt = useLocalizedTrack ? localizedTrack.translatedSrt : metadata.subtitleSrt;
  let cursorFocusTrack = opts.alwaysKeepZoomedIn ? await getCursorFocusTrack(opts.recordingId) : undefined;
  // ffmpeg 仅在兜底路径才加载（WebCodecs 快路径不需要）。

  const preset = ASPECT_PRESETS[opts.aspectRatio];
  const fps = opts.fps;
  const durationMs = metadata.durationMs;
  const format: ExportFormat = opts.format ?? 'mp4';
  const quality: ExportQuality = opts.quality ?? 'auto';
  // 质量档 → ffmpeg CRF（越小越清晰/越大）。WebCodecs 用倍率乘 estimateBitrate。
  const crfFor: Record<ExportQuality, number> = { auto: 23, high: 20, medium: 26, low: 30 };
  const bitrateMul: Record<ExportQuality, number> = { auto: 1, high: 1.6, medium: 0.7, low: 0.4 };

  // 时间轴裁剪：任意多段保留（segments）。缺省/整段=不裁。导出只输出保留段、按序拼接，
  // 输出时间从 0 连续起算，每帧源时间 = outputToSource(kept, 输出时间)。
  const kept = normalizeSegments(opts.segments, durationMs);
  const trimmed = isTrimmed(kept, durationMs);
  const outDurationMs = trimmed ? keptDuration(kept) : durationMs;
  const totalFrames = Math.max(1, Math.round((outDurationMs / 1000) * fps));
  diagnostics.setTotalFrames(totalFrames);

  const filesForExport: Record<string, unknown> = {};
  for (const bf of binaryFiles) filesForExport[bf.fileId] = bf.data;

  // 字幕与水印：在帧画布上直接绘制（不再走 ffmpeg overlay 滤镜）
  const burnSubs = (opts.burnSubtitles ?? true) && !!effectiveSubtitleSrt;
  const cues = burnSubs && effectiveSubtitleSrt ? compileSubtitles(effectiveSubtitleSrt) : [];
  // 水印开启 + 摄像头存在时，水印改放左下角避免与人像气泡视觉打架
  const watermarkPos: 'bottom-right' | 'bottom-left' = effectiveCameraBlob ? 'bottom-left' : 'bottom-right';

  // 工作区 UI 外壳 —— 若录制时捕获到了 shell 且 toggle 开启，叠加到画幅上方。
  // 注意：输出尺寸恒为 picker 选定的比例。shell 与画幅比例不一致时按 cover 缩放裁切。
  const rawShells = await getWorkspaceShells(opts.recordingId);
  const useShell = rawShells.length > 0 && (opts.includeWorkspaceShell ?? true);
  const decodedShells = useShell ? await decodeShells(rawShells) : [];
  // Custom framing 用 customOutput 作输出尺寸；否则用预设。再按清晰度档缩放（白板矢量重渲染→真清晰）。取偶（编码器要求）。
  const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const resScale = RESOLUTION_SCALE[opts.resolution ?? 'fhd'];
  const baseW = opts.customOutput ? opts.customOutput.width : preset.width;
  const baseH = opts.customOutput ? opts.customOutput.height : preset.height;
  const outputW = evenize(baseW * resScale);
  const outputH = evenize(baseH * resScale);

  const contentBox = computeContentBoundingBox(snapshots);
  const fallbackViewport = (() => {
    if (snapshots.length === 0) return DEFAULT_FALLBACK_VIEWPORT;
    const lastVp = viewportFromAppState(snapshots[snapshots.length - 1].appState);
    return lastVp ?? DEFAULT_FALLBACK_VIEWPORT;
  })();

  const cropCtx: CropContext = {
    aspectRatio: opts.aspectRatio,
    croppingMode: opts.croppingMode,
    contentBox,
    fallbackViewport,
    // shell 模式按 canvasRect 比例裁，不应用用户框定窗口
    cropWindow: useShell ? undefined : opts.cropWindow,
  };

  setPhase('rendering_frames');

  // 相同帧去重：静止段（场景/外壳/字幕都没变）直接复用上一帧 PNG，跳过最贵的
  // exportToCanvas + 合成 + toBlob。有激光轨迹时逐帧不同，保守关闭去重以保正确。
  // 注：ffmpeg 兜底里若摄像头改走画布内合成（裁剪场景），逐帧含视频会再关掉去重。
  let dedupEnabled = laserEvents.length === 0 && !screenBlob;
  let lastSig: string | null = null;
  let lastBuf: Uint8Array | null = null;
  // 基帧缓存：场景+外壳+水印只随 snapshot/shell 变化（与字幕无关）
  let lastBaseSig: string | null = null;
  let baseCanvas: HTMLCanvasElement | null = null;
  // WebCodecs 的编码器需要每一帧，但静态白板的像素结果不需要每一帧都重新合成。
  // 仅在没有视频源、激光轨迹和自动推镜时复用最终 canvas；每一个输出时间戳
  // 仍会创建独立 VideoFrame，因此分辨率、帧率和用户选择的画质都完全不变。
  const canReuseFinalFrame = laserEvents.length === 0
    && !screenBlob
    && !effectiveCameraBlob
    && !(opts.autoZooms?.length);
  let lastFinalSig: string | null = null;
  let lastFinalCanvas: HTMLCanvasElement | null = null;

  // 导出会话内复用高分辨率合成层。旧实现每帧创建 3-4 张 Full HD canvas，
  // 几分钟视频会产生数千次大块内存分配和频繁 GC。
  const frameTarget = createContentLayer(outputW, outputH);
  const frameContent = createContentLayer(outputW, outputH);
  const frameForeground = createContentLayer(outputW, outputH);
  const frameBlurScratch = {
    source: createContentLayer(Math.max(2, Math.ceil(outputW / 8)), Math.max(2, Math.ceil(outputH / 8))),
    blurred: createContentLayer(Math.max(2, Math.ceil(outputW / 8)), Math.max(2, Math.ceil(outputH / 8))),
  };
  const displayBlurWorker = screenBlob ? createDisplayBlurWorker(outputW, outputH) : null;
  const resetLayer = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  };

  // 摄像头画布内合成（仅 WebCodecs 路径启用；ffmpeg 路径仍用 overlay 滤镜）
  let compositeCamera = false;
  let cameraSource: CameraFrameSource | null = null;
  if (screenBlob) setPhase('initializing_decoder');
  let displaySource: DisplayFrameSource | null = screenBlob
    ? await createDisplayFrameSource(screenBlob, { signal: opts.signal })
    : null;
  if (displaySource) diagnostics.setDecoderPath('screen', displaySource.decoderPath);
  const createCursorTracking = (): CursorFocusExportAnalyzer | null => {
    if (!opts.alwaysKeepZoomedIn || !screenBlob || !displaySource) return null;
    const signature = cursorFocusSourceSignature(
      screenBlob,
      metadata.durationMs,
      displaySource.width,
      displaySource.height,
    );
    if (cursorFocusTrack?.sourceSignature === signature) return null;
    cursorFocusTrack = undefined;
    return createCursorFocusExportAnalyzer({
      recordingId: opts.recordingId,
      screenBlob,
      durationMs: metadata.durationMs,
      sourceWidth: displaySource.width,
      sourceHeight: displaySource.height,
    });
  };
  let cursorAnalyzer: CursorFocusExportAnalyzer | null = createCursorTracking();
  releaseExportResources = () => {
    try { cameraSource?.close(); } catch { /* best effort */ }
    try { cursorAnalyzer?.close(); } catch { /* best effort */ }
    cursorAnalyzer = null;
    try { displaySource?.close(); } catch { /* best effort */ }
    displaySource = null;
    displayBlurWorker?.close();
    disposeShells(decodedShells);
  };
  abortListener = () => releaseExportResources();
  opts.signal?.addEventListener('abort', abortListener, { once: true });
  setPhase('rendering_frames');
  // 摄像头气泡有效边界（shell-aware，与 ffmpeg 路径同一套换算）
  const camBounds: CameraBounds = (() => {
    if (useShell && decodedShells.length > 0) {
      const first = decodedShells[0];
      const s = Math.min(outputW / first.shellSize.width, outputH / first.shellSize.height);
      const sw = first.shellSize.width * s;
      const sh = first.shellSize.height * s;
      return { offX: (outputW - sw) / 2, offY: (outputH - sh) / 2, w: sw, h: sh };
    }
    return { offX: 0, offY: 0, w: outputW, h: outputH };
  })();

  // 字幕分页：用常驻测量 ctx（导出字体/尺寸恒定）算当前页索引，供去重签名使用，
  // 否则同一 cue 内不同分页的相邻帧会被误判相同而复用 → 分页卡住不翻页。
  const subLayout = subtitleLayout(outputW, outputH, effectiveCameraBlob ? 0.3 : 0);
  const subMeasureCtx = document.createElement('canvas').getContext('2d');
  if (subMeasureCtx) subMeasureCtx.font = subLayout.fontSpec;
  const subPagesCache = new Map<number, number>(); // cue.startMs → pageCount
  const subtitlePageAt = (cue: { startMs: number; endMs: number; text: string }, t: number): number => {
    if (!subMeasureCtx) return 0;
    let pageCount = subPagesCache.get(cue.startMs);
    if (pageCount === undefined) {
      pageCount = chunkByWidth((s) => subMeasureCtx.measureText(s).width, cue.text, subLayout.maxTextWidth).length || 1;
      subPagesCache.set(cue.startMs, pageCount);
    }
    return subtitlePageIndex(pageCount, cue.startMs, cue.endMs, t);
  };

  // 单帧时变输入（便宜，可在去重前算）
  const frameInputs = (i: number) => {
    // 输出时间（成片，从 0 连续）→ 源时间（裁剪映射）。不裁时即 i/fps*1000。
    const t = trimmed ? outputToSource(kept, (i / fps) * 1000) : (i / fps) * 1000;
    const snap = snapshotAt(snapshots, t);
    const shellAtTframe = useShell ? (shellAt(decodedShells, t) as DecodedShell | null) : null;
    const cueAtT = cues.length > 0 ? cueAt(cues, t) : null;
    const sig = `${snap?.timestamp ?? -1}|${shellAtTframe?.timestamp ?? -1}|${cueAtT ? `${cueAtT.startMs}-${cueAtT.endMs}#${subtitlePageAt(cueAtT, t)}` : -1}`;
    return { t, snap, shellAtTframe, sig };
  };

  // 合成一帧到独立 canvas（场景+外壳+水印+字幕），含基帧缓存。ffmpeg / WebCodecs 两路径共用。
  const composeFrame = async (inp: ReturnType<typeof frameInputs>): Promise<HTMLCanvasElement> => {
    if (canReuseFinalFrame && inp.sig === lastFinalSig && lastFinalCanvas) {
      return lastFinalCanvas;
    }
    const { t, snap, shellAtTframe } = inp;
    const target = frameTarget;
    const targetCtx = resetLayer(target);
    const backgroundStarted = performance.now();
    await paintVideoBackground(targetCtx, target.width, target.height, opts.videoBackground, { signal: opts.signal });
    diagnostics.addBreakdown('background_paint', performance.now() - backgroundStarted);
    const content = frameContent;
    const contentCtx = resetLayer(content);
    // foreground 是固定的“录制窗口”内容；背景与窗口外框始终不参与 AutoZoom。
    const foreground = frameForeground;
    const foregroundCtx = resetLayer(foreground);

    const finalizeForeground = async (zoomBounds: CanvasRect, useRecordingWindow = true) => {
      const zoomStarted = performance.now();
      drawZoomedContentLayer(foregroundCtx, content, autoZoomAt(opts.autoZooms, t), zoomBounds);
      diagnostics.addBreakdown('autozoom_composition', performance.now() - zoomStarted);

      if (opts.withWatermark) {
        const watermarkStarted = performance.now();
        drawFrostedWatermark(foregroundCtx, foreground.width, foreground.height, watermarkPos);
        diagnostics.addBreakdown('watermark_composition', performance.now() - watermarkStarted);
      }
      if (cues.length > 0) {
        const subtitleStarted = performance.now();
        drawSubtitle(foregroundCtx, foreground.width, foreground.height, cues, t, {
          reservedRightFraction: effectiveCameraBlob ? 0.3 : 0,
        });
        diagnostics.addBreakdown('subtitle_composition', performance.now() - subtitleStarted);
      }
      if (compositeCamera && cameraSource) {
        const cameraDecodeStarted = performance.now();
        const frame = await cameraSource.getFrameAt(t);
        diagnostics.addBreakdown('camera_decoding', performance.now() - cameraDecodeStarted);
        if (frame) {
          const cameraComposeStarted = performance.now();
          const pos = cameraPositionAt(cameraEvents, t);
          if (!pos) {
            const size = Math.max(16, Math.round(camBounds.h * 0.22));
            const x = Math.round(camBounds.offX + camBounds.w - size - camBounds.w * 0.025);
            const y = Math.round(camBounds.offY + camBounds.h - size - camBounds.h * 0.04);
            drawCameraBubble(foregroundCtx, frame, x, y, size, metadata.setup?.camera.shape ?? 'circle');
          } else if (!pos.hidden) {
            const projected = projectCameraPlacement(cameraPlacementFromEvent(pos), {
              x: camBounds.offX, y: camBounds.offY, width: camBounds.w, height: camBounds.h,
            });
            const size = Math.max(16, Math.round(projected.size));
            const x = Math.round(projected.x);
            const y = Math.round(projected.y);
            drawCameraBubble(foregroundCtx, frame, x, y, size, metadata.setup?.camera.shape ?? 'circle');
          }
          diagnostics.addBreakdown('camera_composition', performance.now() - cameraComposeStarted);
        }
      }

      const foregroundStarted = performance.now();
      if (useRecordingWindow) drawRecordingWindow(targetCtx, foreground, opts.videoBackground);
      else targetCtx.drawImage(foreground, 0, 0);
      diagnostics.addBreakdown('foreground_composition', performance.now() - foregroundStarted);
    };

    if (displaySource) {
      const displayDecodeStarted = performance.now();
      const displayFrame = await displaySource.getFrameAt(t);
      diagnostics.addBreakdown('source_decoding', performance.now() - displayDecodeStarted);
      if (!displayFrame) return target;
      const gpuBlur = opts.croppingMode === 'fit_all_content' && !hasSelectedVideoBackground(opts.videoBackground)
        ? displayBlurWorker?.blur(displayFrame) ?? Promise.resolve(null)
        : Promise.resolve(null);
      const manualFocus = autoZoomAt(opts.autoZooms, t);
      const cursorStarted = performance.now();
      const trackedFocus = !manualFocus && cursorAnalyzer
        ? await cursorAnalyzer.analyzeFrame(displayFrame, t)
        : focusPointAt(cursorFocusTrack, t);
      diagnostics.addBreakdown('cursor_analysis', performance.now() - cursorStarted);
      if (opts.croppingMode === 'fit_all_content' && !hasSelectedVideoBackground(opts.videoBackground)) {
        const blurStarted = performance.now();
        const gpuBackground = await gpuBlur;
        if (gpuBackground) {
          targetCtx.drawImage(gpuBackground, 0, 0, target.width, target.height);
          gpuBackground.close();
          diagnostics.addBreakdown('background_blur_gpu', performance.now() - blurStarted);
        } else {
          paintDisplaySourceFallback(targetCtx, displayFrame, target.width, target.height, frameBlurScratch);
          diagnostics.addBreakdown('background_blur_cpu', performance.now() - blurStarted);
        }
      }
      const displayComposeStarted = performance.now();
      drawDisplayFrame(
        contentCtx,
        displayFrame,
        metadata.source?.kind ?? 'desktop',
        metadata.source?.sourceCropWindow,
        opts.croppingMode,
        target.width,
        target.height,
        1,
        opts.alwaysKeepZoomedIn
          ? (manualFocus
              ? { x: manualFocus.cx ?? 0.5, y: manualFocus.cy ?? 0.5 }
              : trackedFocus)
          : undefined,
      );
      diagnostics.addBreakdown('display_composition', performance.now() - displayComposeStarted);
      // Autozoom changes only the texture inside the recording frame. The frame
      // geometry and the selected background stay fixed for the whole export.
      await finalizeForeground({ x: 0, y: 0, width: content.width, height: content.height });
      return target;
    }

    // 基帧缓存：旁白讲解时画面静止、仅字幕在变 → 复用未缩放的内容层，只重画字幕。
    const baseSig = `${snap?.timestamp ?? -1}|${shellAtTframe?.timestamp ?? -1}`;
    const reuseBase = dedupEnabled && baseSig === lastBaseSig && baseCanvas !== null;
    const frameShellLayout = useShell && shellAtTframe
      ? shellLayout(shellAtTframe, target.width, target.height)
      : null;
    // 只推近白板/屏幕内容。shell 的边框与背景上的前景窗口都保持固定。
    const zoomBounds = frameShellLayout?.canvasRect ?? { x: 0, y: 0, width: content.width, height: content.height };
    if (reuseBase) {
      contentCtx.drawImage(baseCanvas as HTMLCanvasElement, 0, 0);
    } else {
      // shell 模式：先按 contain 把工作区外壳画到内容层，再把 scene 画进映射后的 canvasRect。
      let shellAtT: DecodedShell | null = shellAtTframe;
      if (useShell && shellAtT) {
        contentCtx.drawImage(
          shellAtT.bitmap,
          frameShellLayout!.offsetX,
          frameShellLayout!.offsetY,
          shellAtT.shellSize.width * frameShellLayout!.scale,
          shellAtT.shellSize.height * frameShellLayout!.scale,
        );
      }

      const dest = (() => {
        if (useShell && shellAtT && frameShellLayout) return frameShellLayout.canvasRect;
        return { x: 0, y: 0, width: target.width, height: target.height };
      })();

      if (snap) {
        const boardColor = (snap.appState as { viewBackgroundColor?: string }).viewBackgroundColor ?? '#fbfbfa';
        contentCtx.fillStyle = boardColor;
        contentCtx.fillRect(dest.x, dest.y, dest.width, dest.height);
      }

      const sceneSourceRect: SceneRect = (() => {
        if (useShell && shellAtT) {
          const canvasAspect = shellAtT.canvasRect.width / shellAtT.canvasRect.height;
          return cropRectForAspect(snap, cropCtx, canvasAspect);
        }
        return cropRectForSnapshot(snap, cropCtx);
      })();

      if (snap && (snap.elements as unknown[]).length > 0) {
        const ghost = buildGhostRect(sceneSourceRect);
        const elementsForRender = [ghost, ...(snap.elements as unknown[])];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sceneCanvas: HTMLCanvasElement = await exportToCanvas({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          elements: elementsForRender as any,
          appState: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(snap.appState as any),
            exportBackground: false,
            viewBackgroundColor: 'transparent',
            exportWithDarkMode: false,
            exportPadding: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          files: filesForExport as any,
          getDimensions: (w, h) => ({ width: w, height: h, scale: 1 }),
        });

        const realBBox = elementBoundsUnion(snap.elements as unknown[]);
        const renderedSceneRect: SceneRect = realBBox
          ? unionRect(realBBox, sceneSourceRect)
          : sceneSourceRect;

        const scale = sceneCanvas.width / renderedSceneRect.width;
        const sx = (sceneSourceRect.x - renderedSceneRect.x) * scale;
        const scaleY = sceneCanvas.height / renderedSceneRect.height;
        const sy2 = (sceneSourceRect.y - renderedSceneRect.y) * scaleY;
        const sw = sceneSourceRect.width * scale;
        const sh2 = sceneSourceRect.height * scaleY;

        try {
          contentCtx.drawImage(
            sceneCanvas,
            Math.max(0, sx),
            Math.max(0, sy2),
            Math.min(sw, sceneCanvas.width - sx),
            Math.min(sh2, sceneCanvas.height - sy2),
            dest.x, dest.y, dest.width, dest.height,
          );
        } catch {
          contentCtx.drawImage(sceneCanvas, dest.x, dest.y, dest.width, dest.height);
        }
      }

      if (laserEvents.length > 0) {
        const ssr = sceneSourceRect;
        drawLaserOverlay(contentCtx, laserEvents, t, {
          sceneToScreen: (sx: number, sy: number) => ({
            x: dest.x + ((sx - ssr.x) / ssr.width) * dest.width,
            y: dest.y + ((sy - ssr.y) / ssr.height) * dest.height,
          }),
        });
      }

      if (dedupEnabled) {
        if (!baseCanvas) baseCanvas = document.createElement('canvas');
        baseCanvas.width = target.width;
        baseCanvas.height = target.height;
        baseCanvas.getContext('2d')!.drawImage(content, 0, 0);
        lastBaseSig = baseSig;
      }
    } // end else（基帧渲染）

    // 推镜、字幕、水印与人像都在固定录制窗口内完成；背景与窗口外轮廓不被缩放。
    await finalizeForeground(zoomBounds);
    if (canReuseFinalFrame) {
      lastFinalSig = inp.sig;
      lastFinalCanvas = target;
    }
    return target;
  };

  // —— WebCodecs 硬件编码主路径：浏览器支持时启用，失败自动回退 ffmpeg ——
  // 含摄像头时尝试用 VideoDecoder+webm 解复用把摄像头帧在画布内合成；解码不可用/失败 → 回退。
  // 裁剪也走此路径：音频在解码后按保留段拼接 AudioBuffer（audioSegments），摄像头画布内
  // getFrameAt(源时间) 合成 —— 多段输出映射到的源时间单调不减，与前进式解码器吻合。
  // GIF 无视频编码器路径 → 强制走 ffmpeg（palettegen/paletteuse）。
  // `in globalThis` is not sufficient here: test environments and partially implemented
  // browsers can expose the keys with an undefined value. Treat those as unsupported so
  // the proven ffmpeg fallback is selected rather than failing after export has started.
  if (format !== 'gif' && typeof VideoEncoder !== 'undefined') {
    try {
      diagnostics.setEncoderPath(format === 'webm' ? 'webcodecs-vp9' : 'webcodecs-h264');
      emitDetails(true);
      if (effectiveCameraBlob) {
        cameraSource = await createCameraFrameSource(effectiveCameraBlob); // 失败抛错 → 回退 ffmpeg
        diagnostics.setDecoderPath('camera', cameraSource.decoderPath);
        compositeCamera = true;
      }
      const { encodeWebCodecsMp4 } = await import('./webCodecsExport');
      setPhase('hardware_pipeline');
      const hardwareStarted = performance.now();
      const encoded = await encodeWebCodecsMp4({
        format,
        quality,
        bitrateMultiplier: bitrateMul[quality],
        totalFrames,
        fps,
        width: outputW,
        height: outputH,
        audioBlob: effectiveAudioBlob ?? null,
        audioSegments: trimmed ? kept : undefined,
        signal: opts.signal,
        renderFrame: async (i) => {
          checkCancelled();
          const started = performance.now();
          const canvas = await composeFrame(frameInputs(i));
          diagnostics.addBreakdown('decode_and_compose', performance.now() - started);
          diagnostics.setProcessedFrames(i + 1);
          diagnostics.setDecodedSourceFrames(displaySource?.getDecodedFrameCount?.() ?? 0);
          emitDetails();
          return canvas;
        },
        onProgress: (p) => setProgress(0.08 + p * 0.9),
      });
      diagnostics.addBreakdown('hardware_composition_and_encoding', performance.now() - hardwareStarted);
      let blob = encoded.blob;
      if (effectiveAudioBlob && !encoded.audioEncoded) {
        setPhase('muxing_audio');
        setProgress(0.98);
        const muxStarted = performance.now();
        blob = await remuxEncodedVideoWithAudio(
          blob,
          effectiveAudioBlob,
          format,
          trimmed ? kept : undefined,
          opts.onLog,
        );
        diagnostics.addBreakdown('audio_muxing', performance.now() - muxStarted);
      }
      cameraSource?.close();
      if (cursorAnalyzer) {
        cursorFocusTrack = await cursorAnalyzer.save();
        cursorAnalyzer.close();
        cursorAnalyzer = null;
      }
      displaySource?.close();
      displaySource = null;
      releaseExportResources();
      setPhase('done');
      setProgress(1);
      completeDiagnostics();
      if (abortListener) opts.signal?.removeEventListener('abort', abortListener);
      return blob;
    } catch (err) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      setPhase('fallback_encoding');
      // 回退前清理摄像头解码资源 + 复位标志（ffmpeg 路径用 overlay 自己处理摄像头）
      try { cameraSource?.close(); } catch { /* */ }
      cursorAnalyzer?.close();
      cursorAnalyzer = null;
      try { displaySource?.close(); } catch { /* */ }
      displaySource = screenBlob ? await createDisplayFrameSource(screenBlob) : null;
      if (displaySource) diagnostics.setDecoderPath('screen', displaySource.decoderPath);
      cursorAnalyzer = createCursorTracking();
      cameraSource = null;
      compositeCamera = false;
      // 基帧缓存可能已含半帧状态，复位以免污染 ffmpeg 路径
      lastBaseSig = null;
      baseCanvas = null;
      lastSig = null;
      lastBuf = null;
      lastFinalSig = null;
      lastFinalCanvas = null;
      // eslint-disable-next-line no-console
      console.warn('[export] WebCodecs path failed, falling back to ffmpeg:', err);
    }
  }

  // —— ffmpeg 兜底路径（JPEG 中间帧）——
  diagnostics.setEncoderPath(format === 'gif' ? 'ffmpeg-gif' : format === 'webm' ? 'ffmpeg-vp9' : 'ffmpeg-h264');
  emitDetails(true);
  // 优先在画布中合成摄像头，允许软件路径按短片段编码并及时释放 JPEG。
  // VideoDecoder 不可用时才保留旧的 ffmpeg overlay 兼容方式。
  if (effectiveCameraBlob && !compositeCamera) {
    try {
      cameraSource = await createCameraFrameSource(effectiveCameraBlob);
      diagnostics.setDecoderPath('camera', cameraSource.decoderPath);
      compositeCamera = true;
      dedupEnabled = false; // 逐帧含摄像头视频，关掉整帧去重
    } catch (err) {
      cameraSource = null;
      compositeCamera = false;
      // eslint-disable-next-line no-console
      console.warn('[export] camera decode unavailable; using ffmpeg overlay compatibility path:', err);
    }
  }

  const ffmpeg = await getFfmpeg(opts.onLog);
  const softwareVideoCodec = format === 'webm'
    ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crfFor[quality]), '-pix_fmt', 'yuv420p', '-row-mt', '1']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crfFor[quality]), '-pix_fmt', 'yuv420p'];
  const useSegmentedFrames = format !== 'gif' && (!effectiveCameraBlob || compositeCamera);
  const frameBatches = planExportFrameBatches(totalFrames, fps);
  const frameBatchEnds = new Set(frameBatches.map((batch) => batch.endExclusive));
  const encodedSegments: string[] = [];
  let batchStart = 0;

  const flushFrameBatch = async (endExclusive: number) => {
    if (!useSegmentedFrames || endExclusive <= batchStart) return;
    checkCancelled();
    const segmentName = `segment_${String(encodedSegments.length).padStart(4, '0')}.${format === 'webm' ? 'webm' : 'mp4'}`;
    const encodeStarted = performance.now();
    setPhase('software_encoding_segments');
    await ffmpeg.exec([
      '-framerate', String(fps),
      '-start_number', String(batchStart),
      '-i', 'f_%06d.jpg',
      '-frames:v', String(endExclusive - batchStart),
      ...softwareVideoCodec,
      '-an',
      segmentName,
    ]);
    diagnostics.addBreakdown('software_segment_encoding', performance.now() - encodeStarted);
    encodedSegments.push(segmentName);
    for (let frame = batchStart; frame < endExclusive; frame += 1) {
      try { await ffmpeg.deleteFile(`f_${String(frame).padStart(6, '0')}.jpg`); } catch { /* ignore */ }
    }
    batchStart = endExclusive;
    setPhase('rendering_frames');
  };

  for (let i = 0; i < totalFrames; i++) {
    const inp = frameInputs(i);
    const name = `f_${String(i).padStart(6, '0')}.jpg`;
    if (dedupEnabled && inp.sig === lastSig && lastBuf) {
      // 传副本：writeFile 以 transfer 方式会 detach 传入 buffer，slice() 保留 lastBuf。
      await ffmpeg.writeFile(name, lastBuf.slice());
      diagnostics.setProcessedFrames(i + 1);
      setProgress(0.08 + ((i + 1) / totalFrames) * 0.64);
      if (frameBatchEnds.has(i + 1)) await flushFrameBatch(i + 1);
      continue;
    }
    checkCancelled();
    const composeStarted = performance.now();
    const target = await composeFrame(inp);
    diagnostics.addBreakdown('decode_and_compose', performance.now() - composeStarted);
    const jpegStarted = performance.now();
    const blob: Blob = await new Promise<Blob>((resolve, reject) => {
      target.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob_failed')), 'image/jpeg', 0.92);
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    await ffmpeg.writeFile(name, buf.slice());
    diagnostics.addBreakdown('jpeg_and_virtual_fs', performance.now() - jpegStarted);
    lastBuf = buf;
    lastSig = inp.sig;
    diagnostics.setProcessedFrames(i + 1);
    diagnostics.setDecodedSourceFrames(displaySource?.getDecodedFrameCount?.() ?? 0);
    setProgress(0.08 + ((i + 1) / totalFrames) * 0.64);
    if (frameBatchEnds.has(i + 1)) await flushFrameBatch(i + 1);
  }

  let frameSequenceFile: string | null = null;
  if (useSegmentedFrames) {
    frameSequenceFile = 'segments.txt';
    const concatList = encodedSegments.map((name) => `file '${name}'`).join('\n');
    await ffmpeg.writeFile(frameSequenceFile, new TextEncoder().encode(concatList));
  }

  let audioFile: string | null = null;
  if (effectiveAudioBlob && format !== 'gif') { // GIF 无音轨
    audioFile = 'audio.webm';
    const audioWriteStarted = performance.now();
    await ffmpeg.writeFile(audioFile, new Uint8Array(await effectiveAudioBlob.arrayBuffer()));
    diagnostics.addBreakdown('audio_virtual_fs', performance.now() - audioWriteStarted);
  }

  let cameraFile: string | null = null;
  // 裁剪时摄像头改走画布内合成（见上），不再作为 ffmpeg overlay 输入；不裁时用 overlay 滤镜。
  if (effectiveCameraBlob && !compositeCamera && !trimmed) {
    cameraFile = 'camera.webm';
    await ffmpeg.writeFile(cameraFile, new Uint8Array(await effectiveCameraBlob.arrayBuffer()));
  }

  setPhase('encoding');
  setProgress(0.72);
  ffmpeg.on('progress', ({ progress }) => {
    setProgress(0.72 + Math.min(1, Math.max(0, progress)) * 0.28);
  });

  // 输入顺序：[0] 帧序列 [1] 音频?  [2] 摄像头?(仅不裁时)
  // 注意：水印和字幕已在帧画布层画进 PNG，这里不再有水印 input
  const inputs: string[] = useSegmentedFrames
    ? ['-f', 'concat', '-safe', '0', '-i', frameSequenceFile!]
    : ['-framerate', String(fps), '-i', 'f_%06d.jpg'];
  let nextIdx = 1;
  let audioIdx: number | null = null;
  let cameraIdx: number | null = null;
  if (audioFile) { inputs.push('-i', audioFile); audioIdx = nextIdx++; }
  if (cameraFile) { inputs.push('-i', cameraFile); cameraIdx = nextIdx++; }

  // filter 链：视频侧 camera overlay（仅不裁时）+ 音频侧裁剪拼接（atrim/concat）。
  const filterParts: string[] = [];
  let curLabel = '[0:v]';
  // 与画布路径一致的 alpha mask。圆角方形按 SDF 计算，保证 ffmpeg 回退路径
  // 也会保留录制设置中的 rounded 形状，而不是静默退回圆形。
  const cameraShape = metadata.setup?.camera.shape ?? 'circle';
  const geqMask = cameraShape === 'rounded'
    ? `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(abs(X-W/2)-(W/2-W*0.14),0),2)+pow(max(abs(Y-H/2)-(H/2-H*0.14),0),2),pow(W*0.14,2)),255,0)'`
    : `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-1,2)),0,255)'`;

  if (cameraIdx !== null) {
    // （未裁剪）摄像头气泡的有效边界：shell on 时跟随 letterboxed shell（用首张 shell 做基准）。
    let camBounds: CameraBounds = { offX: 0, offY: 0, w: outputW, h: outputH };
    if (useShell && decodedShells.length > 0) {
      const first = decodedShells[0];
      const s = Math.min(outputW / first.shellSize.width, outputH / first.shellSize.height);
      const sw = first.shellSize.width * s;
      const sh = first.shellSize.height * s;
      camBounds = {
        offX: (outputW - sw) / 2,
        offY: (outputH - sh) / 2,
        w: sw,
        h: sh,
      };
    }
    // ffmpeg 的 camera overlay 发生在已绘制出固定录制窗口的 JPEG 上，
    // 因此需要把相对原始内容的边界投影到前景窗口，而不是落在背景上。
    camBounds = projectBoundsIntoRecordingWindow(camBounds, outputW, outputH, opts.videoBackground);
    const segments = buildCameraSegments(cameraEvents, durationMs, camBounds);

    if (segments.length === 0) {
      // Legacy / 没有位置事件：静态右下角，落在 camBounds 内（shell 时即落在 letterboxed shell 区内）。
      const camSize = Math.max(16, Math.round(camBounds.h * 0.22));
      const overlayX = Math.round(camBounds.offX + camBounds.w - camSize - camBounds.w * 0.025);
      const overlayY = Math.round(camBounds.offY + camBounds.h - camSize - camBounds.h * 0.04);
      filterParts.push(
        `[${cameraIdx}:v]scale=${camSize}:${camSize}:force_original_aspect_ratio=increase,crop=${camSize}:${camSize},hflip,${geqMask}[cam]`,
      );
      filterParts.push(`${curLabel}[cam]overlay=${overlayX}:${overlayY}[v_with_cam]`);
      curLabel = '[v_with_cam]';
    } else {
      // 1 路摄像头 split=N → 每段 scale + crop + hflip + geq → enable=between 叠加
      const labels = segments.map((_, i) => `[c${i}]`);
      filterParts.push(`[${cameraIdx}:v]split=${segments.length}${labels.join('')}`);

      segments.forEach((seg, i) => {
        const s = seg.size;
        // 钳制到画面内，避免负坐标
        const ox = Math.max(0, Math.min(outputW - s, seg.x));
        const oy = Math.max(0, Math.min(outputH - s, seg.y));
        filterParts.push(
          `[c${i}]scale=${s}:${s}:force_original_aspect_ratio=increase,crop=${s}:${s},hflip,${geqMask}[cs${i}]`,
        );
        const nextLabel = i === segments.length - 1 ? '[v_with_cam]' : `[v_cam_${i}]`;
        const t0 = (seg.startMs / 1000).toFixed(3);
        const t1 = (seg.endMs / 1000).toFixed(3);
        filterParts.push(
          `${curLabel}[cs${i}]overlay=${ox}:${oy}:enable='between(t,${t0},${t1})'${nextLabel}`,
        );
        curLabel = nextLabel;
      });
    }
  }

  // 音频裁剪：按保留段 atrim + asetpts 归零，再 concat 拼成连续音轨 [aout]。
  let audioOutLabel: string | null = null;
  if (audioIdx !== null && trimmed) {
    const aLabels: string[] = [];
    kept.forEach((seg, i) => {
      const s0 = (seg.start / 1000).toFixed(3);
      const s1 = (seg.end / 1000).toFixed(3);
      filterParts.push(`[${audioIdx}:a]atrim=start=${s0}:end=${s1},asetpts=PTS-STARTPTS[a${i}]`);
      aLabels.push(`[a${i}]`);
    });
    if (aLabels.length === 1) {
      audioOutLabel = aLabels[0];
    } else {
      filterParts.push(`${aLabels.join('')}concat=n=${aLabels.length}:v=0:a=1[aout]`);
      audioOutLabel = '[aout]';
    }
  }

  const filter: string[] = [];
  const haveVideoFilter = curLabel !== '[0:v]';
  if (filterParts.length > 0) {
    filter.push('-filter_complex', filterParts.join(';'));
    filter.push('-map', haveVideoFilter ? curLabel : '0:v');
    if (audioOutLabel) filter.push('-map', audioOutLabel);
    else if (audioIdx !== null) filter.push('-map', `${audioIdx}:a`);
  } else if (audioIdx !== null) {
    filter.push('-map', '0:v', '-map', `${audioIdx}:a`);
  } else {
    filter.push('-map', '0:v');
  }

  // 按格式选编码器/容器（crf 由质量档决定）；GIF 走调色板、无音轨。
  const vmap = haveVideoFilter ? curLabel : '[0:v]';
  let codec: string[];
  let audioCodec: string[];
  let outName: string;
  let outMime: string;
  if (format === 'gif') {
    // 在已合成视频链后接 palettegen/paletteuse（filterParts 此时只含视频/无音频）。
    const gifParts = [...filterParts,
      `${vmap}split[__gv][__gp]`,
      `[__gp]palettegen=stats_mode=diff[__pal]`,
      `[__gv][__pal]paletteuse=dither=bayer:bayer_scale=3[__gif]`,
    ];
    filter.length = 0;
    filter.push('-filter_complex', gifParts.join(';'), '-map', '[__gif]');
    codec = [];
    audioCodec = [];
    outName = 'output.gif';
    outMime = 'image/gif';
  } else if (format === 'webm') {
    codec = useSegmentedFrames ? ['-c:v', 'copy'] : softwareVideoCodec;
    audioCodec = audioFile ? ['-c:a', 'libopus', '-shortest'] : [];
    outName = 'output.webm';
    outMime = 'video/webm';
  } else {
    // 分段已按最终质量编码，最终仅拼接视频流，避免二次有损编码。
    codec = useSegmentedFrames ? ['-c:v', 'copy'] : softwareVideoCodec;
    audioCodec = audioFile ? ['-c:a', 'aac', '-shortest'] : [];
    outName = 'output.mp4';
    outMime = 'video/mp4';
  }

  const finalEncodeStarted = performance.now();
  await ffmpeg.exec([...inputs, ...filter, ...codec, ...audioCodec, outName]);
  diagnostics.addBreakdown(useSegmentedFrames ? 'software_concat_and_mux' : 'software_final_encoding', performance.now() - finalEncodeStarted);

  const data = await ffmpeg.readFile(outName);
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  if (!useSegmentedFrames) {
    for (let i = 0; i < totalFrames; i++) {
      try { await ffmpeg.deleteFile(`f_${String(i).padStart(6, '0')}.jpg`); } catch { /* ignore */ }
    }
  } else {
    for (const segmentName of encodedSegments) {
      try { await ffmpeg.deleteFile(segmentName); } catch { /* ignore */ }
    }
    if (frameSequenceFile) { try { await ffmpeg.deleteFile(frameSequenceFile); } catch { /* ignore */ } }
  }
  try { await ffmpeg.deleteFile(outName); } catch { /* ignore */ }
  if (audioFile) { try { await ffmpeg.deleteFile(audioFile); } catch { /* ignore */ } }
  if (cameraFile) { try { await ffmpeg.deleteFile(cameraFile); } catch { /* ignore */ } }
  try { cameraSource?.close(); } catch { /* */ } // 裁剪时画布内合成用过的摄像头解码器
  if (cursorAnalyzer) {
    await cursorAnalyzer.save().catch(() => undefined);
    cursorAnalyzer.close();
    cursorAnalyzer = null;
  }
  try { displaySource?.close(); } catch { /* */ }
  displayBlurWorker?.close();
  disposeShells(decodedShells);

  setProgress(1);
  setPhase('done');
  completeDiagnostics();
  if (abortListener) opts.signal?.removeEventListener('abort', abortListener);

  const buffer = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buffer).set(arr);
  return new Blob([buffer], { type: outMime });
  } catch (error) {
    releaseExportResources();
    if (abortListener) opts.signal?.removeEventListener('abort', abortListener);
    diagnostics.setPhase(opts.signal?.aborted ? 'cancelled' : 'failed');
    completeDiagnostics();
    throw error;
  }
}

/**
 * 渲染单个时间点的预览帧到 target canvas（不走 ffmpeg）。
 * 用于导出页的实时预览。
 */
export async function renderPreviewFrame(
  recordingId: string,
  timeMs: number,
  config: ExportConfig,
  target: HTMLCanvasElement,
  metadataOverride?: RecordingMetadata,
  renderSize?: { width: number; height: number },
  signal?: AbortSignal,
): Promise<void> {
  const checkAborted = () => {
    if (signal?.aborted) throw new DOMException('Preview render superseded', 'AbortError');
  };
  checkAborted();
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  const { metadata, snapshots, binaryFiles, cameraBlob, screenBlob, laserEvents } = await loadFullRecording(recordingId);
  checkAborted();
  const cursorFocusTrack = config.alwaysKeepZoomedIn ? await getCursorFocusTrack(recordingId) : undefined;
  const localizedTrack = config.localizedTrackId ? await getLocalizedTrack(config.localizedTrackId) : undefined;
  const useLocalizedTrack = !!localizedTrack && config.muteOriginalAudio !== false;
  const effectiveCameraBlob = useLocalizedTrack && localizedTrack.cameraBlob ? localizedTrack.cameraBlob : cameraBlob;
  const effectiveSubtitleSrt = useLocalizedTrack
    ? localizedTrack.translatedSrt
    : (metadataOverride?.subtitleSrt ?? metadata.subtitleSrt);
  const preset = resolveExportOutputSize(config);

  // 预览也要走 shell-aware 路径
  const decodedShells = (config.includeWorkspaceShell ?? true) ? await getPreviewShells(recordingId) : [];
  const useShell = decodedShells.length > 0;

  // 输出尺寸：Custom 用 customOutput（取偶），否则 picker 比例；shell 按 cover 缩放后绘制
  const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const outputW = evenize(renderSize?.width ?? preset.width);
  const outputH = evenize(renderSize?.height ?? preset.height);

  target.width = outputW;
  target.height = outputH;
  const ctx = target.getContext('2d')!;
  await paintVideoBackground(ctx, target.width, target.height, config.videoBackground, { signal });
  checkAborted();
  const content = createContentLayer(target.width, target.height);
  const contentCtx = content.getContext('2d')!;
  const foreground = createContentLayer(target.width, target.height);
  const foregroundCtx = foreground.getContext('2d')!;

  const hasCamera = !!effectiveCameraBlob;
  const cues = ((config.burnSubtitles ?? true) && effectiveSubtitleSrt)
    ? compileSubtitles(effectiveSubtitleSrt)
    : [];

  const finalizePreviewForeground = (zoomBounds: CanvasRect, useRecordingWindow = true) => {
    drawZoomedContentLayer(foregroundCtx, content, autoZoomAt(config.autoZooms, timeMs), zoomBounds);
    if (config.withWatermark) {
      drawFrostedWatermark(foregroundCtx, foreground.width, foreground.height, hasCamera ? 'bottom-left' : 'bottom-right');
    }
    if (cues.length > 0) {
      drawSubtitle(foregroundCtx, foreground.width, foreground.height, cues, timeMs, {
        reservedRightFraction: hasCamera ? 0.3 : 0,
      });
    }
    if (useRecordingWindow) drawRecordingWindow(ctx, foreground, config.videoBackground);
    else ctx.drawImage(foreground, 0, 0);
  };

  if (screenBlob) {
    const display = await getPreviewDisplaySource(recordingId, screenBlob, timeMs);
    const displayFrame = await display.getFrameAt(timeMs);
    checkAborted();
    if (!displayFrame) return;
    const manualFocus = autoZoomAt(config.autoZooms, timeMs);
    if (config.croppingMode === 'fit_all_content' && !hasSelectedVideoBackground(config.videoBackground)) {
      paintDisplaySourceFallback(ctx, displayFrame, target.width, target.height);
    }
    drawDisplayFrame(
      contentCtx,
      displayFrame,
      metadata.source?.kind ?? 'desktop',
      metadata.source?.sourceCropWindow,
      config.croppingMode,
      target.width,
      target.height,
      1,
      config.alwaysKeepZoomedIn
        ? (manualFocus
            ? { x: manualFocus.cx ?? 0.5, y: manualFocus.cy ?? 0.5 }
            : focusPointAt(cursorFocusTrack, timeMs))
        : undefined,
    );
    finalizePreviewForeground({ x: 0, y: 0, width: content.width, height: content.height });
    return;
  }

  // shell 先铺底（contain / letterbox：整张 shell 完整落在 target 内）
  let shellAtT: DecodedShell | null = null;
  let frameShellLayout: ShellLayout | null = null;
  if (useShell) {
    shellAtT = shellAt(decodedShells, timeMs) as DecodedShell | null;
    if (shellAtT) {
      frameShellLayout = shellLayout(shellAtT, target.width, target.height);
      contentCtx.drawImage(
        shellAtT.bitmap,
        frameShellLayout.offsetX,
        frameShellLayout.offsetY,
        shellAtT.shellSize.width * frameShellLayout.scale,
        shellAtT.shellSize.height * frameShellLayout.scale,
      );
    }
  }

  const snap = snapshotAt(snapshots, timeMs);
  const dest = (useShell && shellAtT && frameShellLayout)
    ? frameShellLayout.canvasRect
    : { x: 0, y: 0, width: target.width, height: target.height };
  if (snap) {
    const boardColor = (snap.appState as { viewBackgroundColor?: string }).viewBackgroundColor ?? '#fbfbfa';
    contentCtx.fillStyle = boardColor;
    contentCtx.fillRect(dest.x, dest.y, dest.width, dest.height);
  }
  if (!snap || (snap.elements as unknown[]).length === 0) {
    finalizePreviewForeground(frameShellLayout?.canvasRect ?? { x: 0, y: 0, width: content.width, height: content.height });
    return;
  }

  const filesForExport: Record<string, unknown> = {};
  for (const bf of binaryFiles) filesForExport[bf.fileId] = bf.data;

  const contentBox = computeContentBoundingBox(snapshots);
  const fallbackViewport = viewportFromAppState(snap.appState) ?? DEFAULT_FALLBACK_VIEWPORT;

  // shell 模式：source 按 canvasRect 的 aspect 裁，croppingMode 仍生效；
  // 非 shell 模式：按 picker preset 裁。
  const sceneSourceRect: SceneRect = (() => {
    if (useShell && shellAtT) {
      const canvasAspect = shellAtT.canvasRect.width / shellAtT.canvasRect.height;
      return cropRectForAspect(snap, { croppingMode: config.croppingMode, contentBox, fallbackViewport }, canvasAspect);
    }
    return cropRectForSnapshot(snap, {
      aspectRatio: config.aspectRatio,
      croppingMode: config.croppingMode,
      contentBox,
      fallbackViewport,
      cropWindow: config.cropWindow,
    });
  })();

  const ghost = buildGhostRect(sceneSourceRect);
  const elementsForRender = [ghost, ...(snap.elements as unknown[])];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneCanvas: HTMLCanvasElement = await exportToCanvas({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements: elementsForRender as any,
    appState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(snap.appState as any),
      exportBackground: false,
      viewBackgroundColor: 'transparent',
      exportWithDarkMode: false,
      exportPadding: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files: filesForExport as any,
    getDimensions: (w, h) => ({ width: w, height: h, scale: 1 }),
  });

  const realBBox = elementBoundsUnion(snap.elements as unknown[]);
  const renderedSceneRect: SceneRect = realBBox
    ? unionRect(realBBox, sceneSourceRect)
    : sceneSourceRect;

  const scale = sceneCanvas.width / renderedSceneRect.width;
  const scaleY = sceneCanvas.height / renderedSceneRect.height;
  const sx = (sceneSourceRect.x - renderedSceneRect.x) * scale;
  const sy = (sceneSourceRect.y - renderedSceneRect.y) * scaleY;
  const sw = sceneSourceRect.width * scale;
  const sh = sceneSourceRect.height * scaleY;

  try {
    contentCtx.drawImage(
      sceneCanvas,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(sw, sceneCanvas.width - sx),
      Math.min(sh, sceneCanvas.height - sy),
      dest.x, dest.y, dest.width, dest.height,
    );
  } catch {
    contentCtx.drawImage(sceneCanvas, dest.x, dest.y, dest.width, dest.height);
  }

  // 激光笔轨迹叠加（预览也需要）
  if (laserEvents.length > 0) {
    drawLaserOverlay(contentCtx, laserEvents, timeMs, {
      sceneToScreen: (vx: number, vy: number) => ({
        x: dest.x + ((vx - sceneSourceRect.x) / sceneSourceRect.width) * dest.width,
        y: dest.y + ((vy - sceneSourceRect.y) / sceneSourceRect.height) * dest.height,
      }),
    });
  }

  finalizePreviewForeground(dest);
}

export const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Chrome acquires large Blob URLs asynchronously. Revoking in the same event loop
  // makes multi-ratio exports fail with NotReadableError after the download begins.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}
