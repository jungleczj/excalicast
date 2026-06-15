'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { getWorkspaceShells, loadFullRecording } from '@/lib/db-client';
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
  type CameraPositionEvent,
  type ExportConfig,
  type SceneRect,
  type WhiteboardSnapshot,
  type WorkspaceShellRow,
} from '@/types/recording';
import { compileSubtitles, drawFrostedWatermark, drawSubtitle, subtitleLayout, chunkByWidth, subtitlePageIndex } from '@/utils/frameOverlays';
import { normalizeSegments, keptDuration, isTrimmed, outputToSource } from '@/utils/segments';
import { cueAt } from '@/utils/srtParser';
import { createCameraFrameSource, type CameraFrameSource } from './webmCameraFrames';
import { drawLaserOverlay } from '@/utils/laserRender';

export interface ExportOptions extends ExportConfig {
  recordingId: string;
  onPhase?: (phase: string) => void;
  onProgress?: (ratio: number) => void;
  onLog?: (message: string) => void;
}

let _ffmpeg: FFmpeg | null = null;

async function getFfmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
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
): { rx: number; ry: number; rs: number; hidden: boolean } | null {
  if (events.length === 0) return null;
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].timestamp <= timeMs) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  const e = events[ans === -1 ? 0 : ans];
  return { rx: e.rx, ry: e.ry, rs: e.rs, hidden: !!e.hidden };
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
    const sz = Math.round(events[i].rs * bounds.w);
    const size = Math.max(16, sz);
    raw.push({
      startMs,
      endMs,
      x: Math.round(bounds.offX + events[i].rx * bounds.w),
      y: Math.round(bounds.offY + events[i].ry * bounds.h),
      size,
    });
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

/** 在画布上把摄像头帧画成镜像圆形气泡（与 ffmpeg overlay 观感一致）。 */
function drawCameraBubble(
  ctx: CanvasRenderingContext2D,
  frame: { displayWidth?: number; displayHeight?: number; codedWidth?: number; codedHeight?: number },
  x: number, y: number, size: number,
): void {
  const fw = frame.displayWidth ?? frame.codedWidth ?? size;
  const fh = frame.displayHeight ?? frame.codedHeight ?? size;
  const s = Math.min(fw, fh);            // cover-crop 成正方形
  const sx = (fw - s) / 2;
  const sy = (fh - s) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.translate(x + size, y);            // 水平镜像（hflip）
  ctx.scale(-1, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.drawImage(frame as any, sx, sy, s, s, 0, 0, size, size);
  ctx.restore();
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
  opts.onPhase?.('loading');
  // 立即上报 1%，让用户看到进度条「在动」
  opts.onProgress?.(0.01);
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  opts.onProgress?.(0.05);
  const { metadata, snapshots, audioBlob, cameraBlob, cameraEvents, laserEvents, binaryFiles } = await loadFullRecording(opts.recordingId);
  opts.onProgress?.(0.08);
  // ffmpeg 仅在兜底路径才加载（WebCodecs 快路径不需要）。

  const preset = ASPECT_PRESETS[opts.aspectRatio];
  const fps = opts.fps;
  const durationMs = metadata.durationMs;

  // 时间轴裁剪：任意多段保留（segments）。缺省/整段=不裁。导出只输出保留段、按序拼接，
  // 输出时间从 0 连续起算，每帧源时间 = outputToSource(kept, 输出时间)。
  const kept = normalizeSegments(opts.segments, durationMs);
  const trimmed = isTrimmed(kept, durationMs);
  const outDurationMs = trimmed ? keptDuration(kept) : durationMs;
  const totalFrames = Math.max(1, Math.round((outDurationMs / 1000) * fps));

  const filesForExport: Record<string, unknown> = {};
  for (const bf of binaryFiles) filesForExport[bf.fileId] = bf.data;

  // 字幕与水印：在帧画布上直接绘制（不再走 ffmpeg overlay 滤镜）
  const burnSubs = (opts.burnSubtitles ?? true) && !!metadata.subtitleSrt;
  const cues = burnSubs ? compileSubtitles(metadata.subtitleSrt) : [];
  // 水印开启 + 摄像头存在时，水印改放左下角避免与人像气泡视觉打架
  const watermarkPos: 'bottom-right' | 'bottom-left' = cameraBlob ? 'bottom-left' : 'bottom-right';

  // 工作区 UI 外壳 —— 若录制时捕获到了 shell 且 toggle 开启，叠加到画幅上方。
  // 注意：输出尺寸恒为 picker 选定的比例。shell 与画幅比例不一致时按 cover 缩放裁切。
  const rawShells = await getWorkspaceShells(opts.recordingId);
  const useShell = rawShells.length > 0 && (opts.includeWorkspaceShell ?? true);
  const decodedShells = useShell ? await decodeShells(rawShells) : [];
  // Custom framing 用 customOutput 作输出尺寸（取偶，编码器要求）；否则用预设。
  const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const outputW = opts.customOutput ? evenize(opts.customOutput.width) : preset.width;
  const outputH = opts.customOutput ? evenize(opts.customOutput.height) : preset.height;

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

  opts.onPhase?.('rendering_frames');

  // 相同帧去重：静止段（场景/外壳/字幕都没变）直接复用上一帧 PNG，跳过最贵的
  // exportToCanvas + 合成 + toBlob。有激光轨迹时逐帧不同，保守关闭去重以保正确。
  // 注：ffmpeg 兜底里若摄像头改走画布内合成（裁剪场景），逐帧含视频会再关掉去重。
  let dedupEnabled = laserEvents.length === 0;
  let lastSig: string | null = null;
  let lastBuf: Uint8Array | null = null;
  // 基帧缓存：场景+外壳+水印只随 snapshot/shell 变化（与字幕无关）
  let lastBaseSig: string | null = null;
  let baseCanvas: HTMLCanvasElement | null = null;

  // 摄像头画布内合成（仅 WebCodecs 路径启用；ffmpeg 路径仍用 overlay 滤镜）
  let compositeCamera = false;
  let cameraSource: CameraFrameSource | null = null;
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
  const subLayout = subtitleLayout(outputW, outputH, cameraBlob ? 0.3 : 0);
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
    const { t, snap, shellAtTframe } = inp;
    const target = document.createElement('canvas');
    target.width = outputW;
    target.height = outputH;
    const targetCtx = target.getContext('2d')!;
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, target.width, target.height);

    // 基帧缓存：旁白讲解时画面静止、仅字幕在变 → 复用上次合成好的基帧（含水印），只重画字幕。
    const baseSig = `${snap?.timestamp ?? -1}|${shellAtTframe?.timestamp ?? -1}`;
    const reuseBase = dedupEnabled && baseSig === lastBaseSig && baseCanvas !== null;
    if (reuseBase) {
      targetCtx.drawImage(baseCanvas as HTMLCanvasElement, 0, 0);
    } else {
      // shell 模式：先按 contain 把工作区外壳画到 target，再把 scene 画进映射后的 canvasRect。
      let shellAtT: DecodedShell | null = shellAtTframe;
      let shellRenderScale = 1;
      let shellOffsetX = 0;
      let shellOffsetY = 0;
      if (useShell && shellAtT) {
        const shellW = shellAtT.shellSize.width;
        const shellH = shellAtT.shellSize.height;
        shellRenderScale = Math.min(target.width / shellW, target.height / shellH);
        const scaledW = shellW * shellRenderScale;
        const scaledH = shellH * shellRenderScale;
        shellOffsetX = (target.width - scaledW) / 2;
        shellOffsetY = (target.height - scaledH) / 2;
        targetCtx.drawImage(shellAtT.bitmap, shellOffsetX, shellOffsetY, scaledW, scaledH);
      }

      const dest = (() => {
        if (useShell && shellAtT) {
          return {
            x: shellOffsetX + shellAtT.canvasRect.x * shellRenderScale,
            y: shellOffsetY + shellAtT.canvasRect.y * shellRenderScale,
            width: shellAtT.canvasRect.width * shellRenderScale,
            height: shellAtT.canvasRect.height * shellRenderScale,
          };
        }
        return { x: 0, y: 0, width: target.width, height: target.height };
      })();

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
            exportBackground: true,
            viewBackgroundColor: '#ffffff',
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
          targetCtx.drawImage(
            sceneCanvas,
            Math.max(0, sx),
            Math.max(0, sy2),
            Math.min(sw, sceneCanvas.width - sx),
            Math.min(sh2, sceneCanvas.height - sy2),
            dest.x, dest.y, dest.width, dest.height,
          );
        } catch {
          targetCtx.drawImage(sceneCanvas, dest.x, dest.y, dest.width, dest.height);
        }
      }

      if (laserEvents.length > 0) {
        const ssr = sceneSourceRect;
        drawLaserOverlay(targetCtx, laserEvents, t, {
          sceneToScreen: (sx: number, sy: number) => ({
            x: dest.x + ((sx - ssr.x) / ssr.width) * dest.width,
            y: dest.y + ((sy - ssr.y) / ssr.height) * dest.height,
          }),
        });
      }

      if (opts.withWatermark) {
        drawFrostedWatermark(targetCtx, target.width, target.height, watermarkPos);
      }
      if (dedupEnabled) {
        if (!baseCanvas) baseCanvas = document.createElement('canvas');
        baseCanvas.width = target.width;
        baseCanvas.height = target.height;
        baseCanvas.getContext('2d')!.drawImage(target, 0, 0);
        lastBaseSig = baseSig;
      }
    } // end else（基帧渲染）

    // 字幕硬嵌入（每帧都画，不入基帧缓存）
    if (cues.length > 0) {
      drawSubtitle(targetCtx, target.width, target.height, cues, t, {
        reservedRightFraction: cameraBlob ? 0.3 : 0,
      });
    }

    // 摄像头气泡（仅 WebCodecs 路径在画布内合成；位置/镜像/隐藏与 ffmpeg overlay 对齐）
    if (compositeCamera && cameraSource) {
      const frame = await cameraSource.getFrameAt(t);
      if (frame) {
        const pos = cameraPositionAt(cameraEvents, t);
        if (!pos) {
          const size = Math.max(16, Math.round(camBounds.h * 0.22));
          const x = Math.round(camBounds.offX + camBounds.w - size - camBounds.w * 0.025);
          const y = Math.round(camBounds.offY + camBounds.h - size - camBounds.h * 0.04);
          drawCameraBubble(targetCtx, frame, x, y, size);
        } else if (!pos.hidden) {
          const size = Math.max(16, Math.round(pos.rs * camBounds.w));
          const x = Math.round(camBounds.offX + pos.rx * camBounds.w);
          const y = Math.round(camBounds.offY + pos.ry * camBounds.h);
          drawCameraBubble(targetCtx, frame, x, y, size);
        }
      }
    }
    return target;
  };

  // —— WebCodecs 硬件编码主路径：浏览器支持时启用，失败自动回退 ffmpeg ——
  // 含摄像头时尝试用 VideoDecoder+webm 解复用把摄像头帧在画布内合成；解码不可用/失败 → 回退。
  // 裁剪也走此路径：音频在解码后按保留段拼接 AudioBuffer（audioSegments），摄像头画布内
  // getFrameAt(源时间) 合成 —— 多段输出映射到的源时间单调不减，与前进式解码器吻合。
  if ('VideoEncoder' in globalThis && 'AudioEncoder' in globalThis) {
    try {
      if (cameraBlob) {
        cameraSource = await createCameraFrameSource(cameraBlob); // 失败抛错 → 回退 ffmpeg
        compositeCamera = true;
      }
      const { encodeWebCodecsMp4 } = await import('./webCodecsExport');
      const blob = await encodeWebCodecsMp4({
        totalFrames,
        fps,
        width: outputW,
        height: outputH,
        audioBlob: audioBlob ?? null,
        audioSegments: trimmed ? kept : undefined,
        renderFrame: async (i) => composeFrame(frameInputs(i)),
        onProgress: (p) => opts.onProgress?.(0.08 + p * 0.9),
      });
      cameraSource?.close();
      opts.onPhase?.('done');
      opts.onProgress?.(1);
      return blob;
    } catch (err) {
      // 回退前清理摄像头解码资源 + 复位标志（ffmpeg 路径用 overlay 自己处理摄像头）
      try { cameraSource?.close(); } catch { /* */ }
      cameraSource = null;
      compositeCamera = false;
      // 基帧缓存可能已含半帧状态，复位以免污染 ffmpeg 路径
      lastBaseSig = null;
      baseCanvas = null;
      lastSig = null;
      lastBuf = null;
      // eslint-disable-next-line no-console
      console.warn('[export] WebCodecs path failed, falling back to ffmpeg:', err);
    }
  }

  // —— ffmpeg 兜底路径（JPEG 中间帧）——
  // 裁剪场景下摄像头改走画布内合成（getFrameAt(源时间)），避免多段把连续摄像头流
  // 用 overlay 重映射的复杂度；不裁时仍走下方 ffmpeg overlay 滤镜。
  if (trimmed && cameraBlob && !compositeCamera) {
    try {
      cameraSource = await createCameraFrameSource(cameraBlob);
      compositeCamera = true;
      dedupEnabled = false; // 逐帧含摄像头视频，关掉整帧去重
    } catch (err) {
      cameraSource = null;
      compositeCamera = false;
      // eslint-disable-next-line no-console
      console.warn('[export] ffmpeg trim path: camera decode unavailable, dropping bubble:', err);
    }
  }

  const ffmpeg = await getFfmpeg(opts.onLog);
  for (let i = 0; i < totalFrames; i++) {
    const inp = frameInputs(i);
    const name = `f_${String(i).padStart(6, '0')}.jpg`;
    if (dedupEnabled && inp.sig === lastSig && lastBuf) {
      // 传副本：writeFile 以 transfer 方式会 detach 传入 buffer，slice() 保留 lastBuf。
      await ffmpeg.writeFile(name, lastBuf.slice());
      opts.onProgress?.(0.08 + ((i + 1) / totalFrames) * 0.64);
      continue;
    }
    const target = await composeFrame(inp);
    const blob: Blob = await new Promise<Blob>((resolve, reject) => {
      target.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob_failed')), 'image/jpeg', 0.92);
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    await ffmpeg.writeFile(name, buf.slice());
    lastBuf = buf;
    lastSig = inp.sig;
    opts.onProgress?.(0.08 + ((i + 1) / totalFrames) * 0.64);
  }

  let audioFile: string | null = null;
  if (audioBlob) {
    audioFile = 'audio.webm';
    await ffmpeg.writeFile(audioFile, new Uint8Array(await audioBlob.arrayBuffer()));
  }

  let cameraFile: string | null = null;
  // 裁剪时摄像头改走画布内合成（见上），不再作为 ffmpeg overlay 输入；不裁时用 overlay 滤镜。
  if (cameraBlob && !trimmed) {
    cameraFile = 'camera.webm';
    await ffmpeg.writeFile(cameraFile, new Uint8Array(await cameraBlob.arrayBuffer()));
  }

  opts.onPhase?.('encoding');
  opts.onProgress?.(0.72);
  ffmpeg.on('progress', ({ progress }) => {
    opts.onProgress?.(0.72 + Math.min(1, Math.max(0, progress)) * 0.28);
  });

  // 输入顺序：[0] 帧序列 [1] 音频?  [2] 摄像头?(仅不裁时)
  // 注意：水印和字幕已在帧画布层画进 PNG，这里不再有水印 input
  const inputs: string[] = ['-framerate', String(fps), '-i', 'f_%06d.jpg'];
  let nextIdx = 1;
  let audioIdx: number | null = null;
  let cameraIdx: number | null = null;
  if (audioFile) { inputs.push('-i', audioFile); audioIdx = nextIdx++; }
  if (cameraFile) { inputs.push('-i', cameraFile); cameraIdx = nextIdx++; }

  // filter 链：视频侧 camera overlay（仅不裁时）+ 音频侧裁剪拼接（atrim/concat）。
  const filterParts: string[] = [];
  let curLabel = '[0:v]';
  // 圆形 alpha mask 的 geq 表达式 —— 多段也复用同一段
  const geqMask = `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-1,2)),0,255)'`;

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

  // veryfast + crf 23：相比 ultrafast 体积显著更小、清晰度更好，编码耗时相近（单线程核）。
  const codec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const audioCodec = audioFile ? ['-c:a', 'aac', '-shortest'] : [];

  await ffmpeg.exec([...inputs, ...filter, ...codec, ...audioCodec, 'output.mp4']);

  const data = await ffmpeg.readFile('output.mp4');
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  for (let i = 0; i < totalFrames; i++) {
    try { await ffmpeg.deleteFile(`f_${String(i).padStart(6, '0')}.jpg`); } catch { /* ignore */ }
  }
  try { await ffmpeg.deleteFile('output.mp4'); } catch { /* ignore */ }
  if (audioFile) { try { await ffmpeg.deleteFile(audioFile); } catch { /* ignore */ } }
  if (cameraFile) { try { await ffmpeg.deleteFile(cameraFile); } catch { /* ignore */ } }
  try { cameraSource?.close(); } catch { /* */ } // 裁剪时画布内合成用过的摄像头解码器
  disposeShells(decodedShells);

  opts.onProgress?.(1);
  opts.onPhase?.('done');

  const buffer = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buffer).set(arr);
  return new Blob([buffer], { type: 'video/mp4' });
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
): Promise<void> {
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  const { metadata, snapshots, binaryFiles, cameraBlob, laserEvents } = await loadFullRecording(recordingId);
  const preset = ASPECT_PRESETS[config.aspectRatio];

  // 预览也要走 shell-aware 路径
  const rawShells = await getWorkspaceShells(recordingId);
  const useShell = rawShells.length > 0 && (config.includeWorkspaceShell ?? true);
  const decodedShells = useShell ? await decodeShells(rawShells) : [];

  // 输出尺寸：Custom 用 customOutput（取偶），否则 picker 比例；shell 按 cover 缩放后绘制
  const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const outputW = config.customOutput ? evenize(config.customOutput.width) : preset.width;
  const outputH = config.customOutput ? evenize(config.customOutput.height) : preset.height;

  target.width = outputW;
  target.height = outputH;
  const ctx = target.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);

  const hasCamera = !!cameraBlob;
  const cues = ((config.burnSubtitles ?? true) && metadata.subtitleSrt)
    ? compileSubtitles(metadata.subtitleSrt)
    : [];

  // shell 先铺底（contain / letterbox：整张 shell 完整落在 target 内）
  let shellAtT: DecodedShell | null = null;
  let shellRenderScale = 1;
  let shellOffsetX = 0;
  let shellOffsetY = 0;
  if (useShell) {
    shellAtT = shellAt(decodedShells, timeMs) as DecodedShell | null;
    if (shellAtT) {
      const shellW = shellAtT.shellSize.width;
      const shellH = shellAtT.shellSize.height;
      shellRenderScale = Math.min(target.width / shellW, target.height / shellH);
      const scaledW = shellW * shellRenderScale;
      const scaledH = shellH * shellRenderScale;
      shellOffsetX = (target.width - scaledW) / 2;
      shellOffsetY = (target.height - scaledH) / 2;
      ctx.drawImage(shellAtT.bitmap, shellOffsetX, shellOffsetY, scaledW, scaledH);
    }
  }

  const snap = snapshotAt(snapshots, timeMs);
  if (!snap || (snap.elements as unknown[]).length === 0) {
    if (config.withWatermark) {
      drawFrostedWatermark(ctx, target.width, target.height, hasCamera ? 'bottom-left' : 'bottom-right');
    }
    if (cues.length > 0) {
      drawSubtitle(ctx, target.width, target.height, cues, timeMs, {
        reservedRightFraction: hasCamera ? 0.3 : 0,
      });
    }
    disposeShells(decodedShells);
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

  const dest = (useShell && shellAtT)
    ? {
        x: shellOffsetX + shellAtT.canvasRect.x * shellRenderScale,
        y: shellOffsetY + shellAtT.canvasRect.y * shellRenderScale,
        width: shellAtT.canvasRect.width * shellRenderScale,
        height: shellAtT.canvasRect.height * shellRenderScale,
      }
    : { x: 0, y: 0, width: target.width, height: target.height };

  const ghost = buildGhostRect(sceneSourceRect);
  const elementsForRender = [ghost, ...(snap.elements as unknown[])];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneCanvas: HTMLCanvasElement = await exportToCanvas({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements: elementsForRender as any,
    appState: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(snap.appState as any),
      exportBackground: true,
      viewBackgroundColor: '#ffffff',
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
    ctx.drawImage(
      sceneCanvas,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(sw, sceneCanvas.width - sx),
      Math.min(sh, sceneCanvas.height - sy),
      dest.x, dest.y, dest.width, dest.height,
    );
  } catch {
    ctx.drawImage(sceneCanvas, dest.x, dest.y, dest.width, dest.height);
  }

  // 激光笔轨迹叠加（预览也需要）
  if (laserEvents.length > 0) {
    drawLaserOverlay(ctx, laserEvents, timeMs, {
      sceneToScreen: (vx: number, vy: number) => ({
        x: dest.x + ((vx - sceneSourceRect.x) / sceneSourceRect.width) * dest.width,
        y: dest.y + ((vy - sceneSourceRect.y) / sceneSourceRect.height) * dest.height,
      }),
    });
  }

  disposeShells(decodedShells);

  if (config.withWatermark) {
    drawFrostedWatermark(ctx, target.width, target.height, hasCamera ? 'bottom-left' : 'bottom-right');
  }
  if (cues.length > 0) {
    drawSubtitle(ctx, target.width, target.height, cues, timeMs, {
      reservedRightFraction: hasCamera ? 0.3 : 0,
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
