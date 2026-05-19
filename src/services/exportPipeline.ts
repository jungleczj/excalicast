'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { loadFullRecording } from '@/lib/db-client';
import {
  cropRectForSnapshot,
  computeContentBoundingBox,
  viewportFromAppState,
  DEFAULT_FALLBACK_VIEWPORT,
  type CropContext,
} from '@/services/cropping';
import { ASPECT_PRESETS, type ExportConfig, type SceneRect, type WhiteboardSnapshot } from '@/types/recording';
import { compileSubtitles, drawFrostedWatermark, drawSubtitle } from '@/utils/frameOverlays';

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
  // 立即上报 1%，让用户看到进度条「在动」，避免 ffmpeg.load() 期间卡 0% 的体感
  opts.onProgress?.(0.01);
  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.05);
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  opts.onProgress?.(0.07);
  const { metadata, snapshots, audioBlob, cameraBlob, binaryFiles } = await loadFullRecording(opts.recordingId);
  opts.onProgress?.(0.08);

  const preset = ASPECT_PRESETS[opts.aspectRatio];
  const fps = opts.fps;
  const durationMs = metadata.durationMs;
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));

  const filesForExport: Record<string, unknown> = {};
  for (const bf of binaryFiles) filesForExport[bf.fileId] = bf.data;

  // 字幕与水印：在帧画布上直接绘制（不再走 ffmpeg overlay 滤镜）
  const burnSubs = (opts.burnSubtitles ?? true) && !!metadata.subtitleSrt;
  const cues = burnSubs ? compileSubtitles(metadata.subtitleSrt) : [];
  // 水印开启 + 摄像头存在时，水印改放左下角避免与人像气泡视觉打架
  const watermarkPos: 'bottom-right' | 'bottom-left' = cameraBlob ? 'bottom-left' : 'bottom-right';

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
  };

  opts.onPhase?.('rendering_frames');

  for (let i = 0; i < totalFrames; i++) {
    const t = (i / fps) * 1000;
    const snap = snapshotAt(snapshots, t);
    const cropRect = cropRectForSnapshot(snap, cropCtx);

    // 渲染目标尺寸 = preset
    const target = document.createElement('canvas');
    target.width = preset.width;
    target.height = preset.height;
    const targetCtx = target.getContext('2d')!;
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, target.width, target.height);

    if (snap && (snap.elements as unknown[]).length > 0) {
      const ghost = buildGhostRect(cropRect);
      const elementsForRender = [ghost, ...(snap.elements as unknown[])];

      // exportToCanvas 自身按 commonBounds + padding 决定输出尺寸；
      // 我们让它按 scale=1 渲染，然后我们自己 drawImage 裁切到 target
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

      // 计算 scene 中 sceneCanvas 实际覆盖的 rect：
      // = union(realElementsBBox, cropRect)
      const realBBox = elementBoundsUnion(snap.elements as unknown[]);
      const renderedSceneRect: SceneRect = realBBox
        ? unionRect(realBBox, cropRect)
        : cropRect;

      const scale = sceneCanvas.width / renderedSceneRect.width;
      const sx = (cropRect.x - renderedSceneRect.x) * scale;
      const sy = (cropRect.y - renderedSceneRect.y) * scale;
      const sw = cropRect.width * scale;
      const sh = cropRect.height * scale;

      // sceneCanvas 长宽比 = renderedSceneRect 的长宽比；垂直方向的 scale 应该相同
      // 校验：scale_y = sceneCanvas.height / renderedSceneRect.height ≈ scale
      // 若不一致按各自轴向计算
      const scaleY = sceneCanvas.height / renderedSceneRect.height;
      const sy2 = (cropRect.y - renderedSceneRect.y) * scaleY;
      const sh2 = cropRect.height * scaleY;

      try {
        targetCtx.drawImage(
          sceneCanvas,
          Math.max(0, sx),
          Math.max(0, sy2),
          Math.min(sw, sceneCanvas.width - sx),
          Math.min(sh2, sceneCanvas.height - sy2),
          0, 0, target.width, target.height,
        );
      } catch {
        // 如果裁切参数越界（极端情况），退化为全图绘制
        targetCtx.drawImage(sceneCanvas, 0, 0, target.width, target.height);
      }
    }

    // 毛玻璃水印（在字幕之前画 — 字幕居中位置可能与水印边角重叠，字幕在上更可读）
    if (opts.withWatermark) {
      drawFrostedWatermark(targetCtx, target.width, target.height, watermarkPos);
    }
    // 字幕硬嵌入（摄像头在右下角时为其预留空间）
    if (cues.length > 0) {
      drawSubtitle(targetCtx, target.width, target.height, cues, t, {
        reservedRightFraction: cameraBlob ? 0.3 : 0,
      });
    }

    const blob: Blob = await new Promise<Blob>((resolve, reject) => {
      target.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob_failed')), 'image/png');
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const name = `f_${String(i).padStart(6, '0')}.png`;
    await ffmpeg.writeFile(name, buf);

    // 帧渲染占 8% → 72% 区间（0.64 宽）
    opts.onProgress?.(0.08 + ((i + 1) / totalFrames) * 0.64);
  }

  let audioFile: string | null = null;
  if (audioBlob) {
    audioFile = 'audio.webm';
    await ffmpeg.writeFile(audioFile, new Uint8Array(await audioBlob.arrayBuffer()));
  }

  let cameraFile: string | null = null;
  if (cameraBlob) {
    cameraFile = 'camera.webm';
    await ffmpeg.writeFile(cameraFile, new Uint8Array(await cameraBlob.arrayBuffer()));
  }

  opts.onPhase?.('encoding');
  opts.onProgress?.(0.72);
  ffmpeg.on('progress', ({ progress }) => {
    opts.onProgress?.(0.72 + Math.min(1, Math.max(0, progress)) * 0.28);
  });

  // 输入顺序：[0] 帧序列 [1] 音频?  [2] 摄像头?
  // 注意：水印和字幕已在帧画布层画进 PNG，这里不再有水印 input
  const inputs: string[] = ['-framerate', String(fps), '-i', 'f_%06d.png'];
  let nextIdx = 1;
  let audioIdx: number | null = null;
  let cameraIdx: number | null = null;
  if (audioFile) { inputs.push('-i', audioFile); audioIdx = nextIdx++; }
  if (cameraFile) { inputs.push('-i', cameraFile); cameraIdx = nextIdx++; }

  // filter 链：仅保留 camera overlay（人像气泡用 ffmpeg 合成是为了用视频流，
  // 不能简单 burn 进 PNG —— 摄像头视频独立时间线）
  const filterParts: string[] = [];
  let curLabel = '[0:v]';
  const camSize = Math.round(preset.height * 0.22);
  if (cameraIdx !== null) {
    filterParts.push(
      `[${cameraIdx}:v]scale=${camSize}:${camSize}:force_original_aspect_ratio=increase,crop=${camSize}:${camSize},hflip,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-1,2)),0,255)'[cam]`,
    );
    filterParts.push(`${curLabel}[cam]overlay=W-w-${Math.round(preset.width * 0.025)}:H-h-${Math.round(preset.height * 0.04)}[v_with_cam]`);
    curLabel = '[v_with_cam]';
  }

  const filter: string[] = [];
  if (filterParts.length > 0) {
    filter.push('-filter_complex', filterParts.join(';'));
    filter.push('-map', curLabel);
    if (audioIdx !== null) filter.push('-map', `${audioIdx}:a`);
  } else if (audioIdx !== null) {
    filter.push('-map', '0:v', '-map', `${audioIdx}:a`);
  } else {
    filter.push('-map', '0:v');
  }

  const codec = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  const audioCodec = audioFile ? ['-c:a', 'aac', '-shortest'] : [];

  await ffmpeg.exec([...inputs, ...filter, ...codec, ...audioCodec, 'output.mp4']);

  const data = await ffmpeg.readFile('output.mp4');
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  for (let i = 0; i < totalFrames; i++) {
    try { await ffmpeg.deleteFile(`f_${String(i).padStart(6, '0')}.png`); } catch { /* ignore */ }
  }
  try { await ffmpeg.deleteFile('output.mp4'); } catch { /* ignore */ }
  if (audioFile) { try { await ffmpeg.deleteFile(audioFile); } catch { /* ignore */ } }
  if (cameraFile) { try { await ffmpeg.deleteFile(cameraFile); } catch { /* ignore */ } }

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
  const { metadata, snapshots, binaryFiles, cameraBlob } = await loadFullRecording(recordingId);
  const preset = ASPECT_PRESETS[config.aspectRatio];

  target.width = preset.width;
  target.height = preset.height;
  const ctx = target.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.width, target.height);

  const hasCamera = !!cameraBlob;
  const cues = ((config.burnSubtitles ?? true) && metadata.subtitleSrt)
    ? compileSubtitles(metadata.subtitleSrt)
    : [];

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
    return;
  }

  const filesForExport: Record<string, unknown> = {};
  for (const bf of binaryFiles) filesForExport[bf.fileId] = bf.data;

  const contentBox = computeContentBoundingBox(snapshots);
  const fallbackViewport = viewportFromAppState(snap.appState) ?? DEFAULT_FALLBACK_VIEWPORT;
  const cropRect = cropRectForSnapshot(snap, {
    aspectRatio: config.aspectRatio,
    croppingMode: config.croppingMode,
    contentBox,
    fallbackViewport,
  });

  const ghost = buildGhostRect(cropRect);
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
    ? unionRect(realBBox, cropRect)
    : cropRect;

  const scale = sceneCanvas.width / renderedSceneRect.width;
  const scaleY = sceneCanvas.height / renderedSceneRect.height;
  const sx = (cropRect.x - renderedSceneRect.x) * scale;
  const sy = (cropRect.y - renderedSceneRect.y) * scaleY;
  const sw = cropRect.width * scale;
  const sh = cropRect.height * scaleY;

  try {
    ctx.drawImage(
      sceneCanvas,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(sw, sceneCanvas.width - sx),
      Math.min(sh, sceneCanvas.height - sy),
      0, 0, target.width, target.height,
    );
  } catch {
    ctx.drawImage(sceneCanvas, 0, 0, target.width, target.height);
  }

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
