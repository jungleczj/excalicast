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
import { compileSubtitles, drawFrostedWatermark, drawSubtitle } from '@/utils/frameOverlays';
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
  // 立即上报 1%，让用户看到进度条「在动」，避免 ffmpeg.load() 期间卡 0% 的体感
  opts.onProgress?.(0.01);
  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.05);
  const { exportToCanvas } = await import('@excalidraw/excalidraw');
  opts.onProgress?.(0.07);
  const { metadata, snapshots, audioBlob, cameraBlob, cameraEvents, laserEvents, binaryFiles } = await loadFullRecording(opts.recordingId);
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

  // 工作区 UI 外壳 —— 若录制时捕获到了 shell 且 toggle 开启，叠加到画幅上方。
  // 注意：输出尺寸恒为 picker 选定的比例。shell 与画幅比例不一致时按 cover 缩放裁切。
  const rawShells = await getWorkspaceShells(opts.recordingId);
  const useShell = rawShells.length > 0 && (opts.includeWorkspaceShell ?? true);
  const decodedShells = useShell ? await decodeShells(rawShells) : [];
  const outputW = preset.width;
  const outputH = preset.height;

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

    // 渲染目标尺寸
    const target = document.createElement('canvas');
    target.width = outputW;
    target.height = outputH;
    const targetCtx = target.getContext('2d')!;
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, target.width, target.height);

    // shell 模式：先按 cover 把工作区外壳画到 target，再把 scene 画进映射后的 canvasRect。
    // 否则：scene 直接铺满 target（picker 比例 == target 比例）。
    let shellAtT: DecodedShell | null = null;
    let shellRenderScale = 1;
    let shellOffsetX = 0;
    let shellOffsetY = 0;
    if (useShell) {
      shellAtT = shellAt(decodedShells, t) as DecodedShell | null;
      if (shellAtT) {
        const shellW = shellAtT.shellSize.width;
        const shellH = shellAtT.shellSize.height;
        // contain（letterbox）：取较小缩放比，让整张 shell 完整落在 target 内、四周可能留白。
        // 这是用户期望的"整体缩放画面，包括 workspace UI"行为。
        shellRenderScale = Math.min(target.width / shellW, target.height / shellH);
        const scaledW = shellW * shellRenderScale;
        const scaledH = shellH * shellRenderScale;
        shellOffsetX = (target.width - scaledW) / 2;
        shellOffsetY = (target.height - scaledH) / 2;
        targetCtx.drawImage(shellAtT.bitmap, shellOffsetX, shellOffsetY, scaledW, scaledH);
      }
    }

    // 决定本帧 scene 渲染的目标区域 + 源 crop rect
    const dest = (() => {
      if (useShell && shellAtT) {
        // canvasRect 在 shell 原始坐标里 → 通过 contain 变换映射到 target 坐标
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
        // shell 模式：scene 画进 mapped canvasRect（其 aspect = canvasRect.w/h），
        // 所以 source 也按 canvasRect 的 aspect 裁；croppingMode 仍然生效，
        // fit_all_content 在 shell 路径下也能正常套全部内容。
        const canvasAspect = shellAtT.canvasRect.width / shellAtT.canvasRect.height;
        return cropRectForAspect(snap, cropCtx, canvasAspect);
      }
      // 非 shell 模式：恒按 picker 比例裁场景，填满 target
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

    // 激光笔轨迹叠加 —— scene 坐标按 sceneSourceRect→dest 映射到 target 像素
    if (laserEvents.length > 0) {
      const ssr = sceneSourceRect;
      drawLaserOverlay(targetCtx, laserEvents, t, {
        sceneToScreen: (sx: number, sy: number) => ({
          x: dest.x + ((sx - ssr.x) / ssr.width) * dest.width,
          y: dest.y + ((sy - ssr.y) / ssr.height) * dest.height,
        }),
      });
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
  // 圆形 alpha mask 的 geq 表达式 —— 多段也复用同一段
  const geqMask = `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-W/2,2)+pow(Y-H/2,2),pow(W/2-1,2)),0,255)'`;

  if (cameraIdx !== null) {
    // 摄像头气泡的有效边界：shell on 时跟随 letterboxed shell（用首张 shell 做基准，
    // 避免单帧 shell 尺寸变化导致 enable 区间 x/y 不连续）；shell off 时整张 target。
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

  // 输出尺寸恒为 picker 比例；shell 按 cover 缩放后绘制
  const outputW = preset.width;
  const outputH = preset.height;

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
