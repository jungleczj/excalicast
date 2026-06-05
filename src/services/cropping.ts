'use client';

import type { WhiteboardSnapshot, AspectRatio, CroppingMode, CropWindow, SceneRect } from '@/types/recording';
import { ASPECT_PRESETS } from '@/types/recording';

/**
 * 从 Excalidraw 的 appState 读出当前视口（scene 坐标系下用户看到的矩形）。
 * Excalidraw 在 appState 中保存：
 *   - scrollX, scrollY: 视口左上角对应的 scene 坐标的负值（Excalidraw 内部约定）
 *   - zoom: { value: number } 或 number
 *   - width, height: 容器像素尺寸
 *
 * scene 坐标 = (screen_pixel - scrollX) / zoom，因此：
 *   visible scene rect = { x: -scrollX / zoom, y: -scrollY / zoom, w: width / zoom, h: height / zoom }
 *
 * 当 width/height 缺失时（如刚启动）回退到一个合理默认值。
 */
export function viewportFromAppState(appState: Record<string, unknown>): SceneRect | null {
  const scrollX = typeof appState.scrollX === 'number' ? appState.scrollX : 0;
  const scrollY = typeof appState.scrollY === 'number' ? appState.scrollY : 0;
  const zoomRaw = appState.zoom;
  const zoom: number = typeof zoomRaw === 'number'
    ? zoomRaw
    : (zoomRaw && typeof zoomRaw === 'object' && 'value' in (zoomRaw as object)
        ? Number((zoomRaw as { value: unknown }).value) || 1
        : 1);
  const width = typeof appState.width === 'number' ? appState.width : null;
  const height = typeof appState.height === 'number' ? appState.height : null;
  if (width === null || height === null || zoom <= 0) return null;
  return {
    x: -scrollX,
    y: -scrollY,
    width: width / zoom,
    height: height / zoom,
  };
}

interface ElementBox { x: number; y: number; w: number; h: number; }

function elementBox(el: unknown): ElementBox | null {
  if (!el || typeof el !== 'object') return null;
  const e = el as Record<string, unknown>;
  if (e.isDeleted === true) return null;
  const x = Number(e.x);
  const y = Number(e.y);
  const w = Number(e.width);
  const h = Number(e.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x, y, w, h };
}

/**
 * 计算所有快照中所有元素的并集 bbox（scene 坐标）。
 * 用于 fit_all_content 模式。
 */
export function computeContentBoundingBox(snapshots: WhiteboardSnapshot[]): SceneRect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasAny = false;
  for (const snap of snapshots) {
    for (const el of snap.elements) {
      const b = elementBox(el);
      if (!b) continue;
      hasAny = true;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
  }
  if (!hasAny) return null;
  // 加 5% padding
  const padX = (maxX - minX) * 0.05;
  const padY = (maxY - minY) * 0.05;
  return { x: minX - padX, y: minY - padY, width: (maxX - minX) + padX * 2, height: (maxY - minY) + padY * 2 };
}

/**
 * 把 source 矩形按 target 比例做 cover 裁切（保持中心，裁掉多余部分）。
 * 用于「跟随视口」+ 比例不一致的情况。
 */
export function coverCrop(source: SceneRect, targetAspect: number): SceneRect {
  const srcAspect = source.width / source.height;
  if (srcAspect > targetAspect) {
    // 源更宽，裁左右
    const newW = source.height * targetAspect;
    return {
      x: source.x + (source.width - newW) / 2,
      y: source.y,
      width: newW,
      height: source.height,
    };
  }
  if (srcAspect < targetAspect) {
    // 源更高，裁上下
    const newH = source.width / targetAspect;
    return {
      x: source.x,
      y: source.y + (source.height - newH) / 2,
      width: source.width,
      height: newH,
    };
  }
  return source;
}

/**
 * 把 source 矩形按 target 比例做 contain 布局（保留全部内容，扩大矩形以匹配比例）。
 * 用于「自动套全部内容」。
 */
export function containExpand(source: SceneRect, targetAspect: number): SceneRect {
  const srcAspect = source.width / source.height;
  if (srcAspect < targetAspect) {
    // 源更窄，左右扩
    const newW = source.height * targetAspect;
    return {
      x: source.x - (newW - source.width) / 2,
      y: source.y,
      width: newW,
      height: source.height,
    };
  }
  if (srcAspect > targetAspect) {
    // 源更宽，上下扩
    const newH = source.width / targetAspect;
    return {
      x: source.x,
      y: source.y - (newH - source.height) / 2,
      width: source.width,
      height: newH,
    };
  }
  return source;
}

/**
 * 给定一个时间点，计算输出帧应该展示的 scene 矩形。
 *
 * follow_viewport: 取该时刻 snapshot 的视口 → cover crop 到 target aspect
 * fit_all_content: 全程内容 bbox → contain expand 到 target aspect（与时间无关）
 */
export interface CropContext {
  aspectRatio: AspectRatio;
  croppingMode: CroppingMode;
  /** 仅在 fit_all_content 模式下使用 */
  contentBox: SceneRect | null;
  /** follow_viewport 模式的兜底矩形（当 snapshot 没有 viewport 信息时用） */
  fallbackViewport: SceneRect;
  /** 录制时框定的裁切框（画布区比例）；follow_viewport 下覆盖默认居中 cover-crop。 */
  cropWindow?: CropWindow;
}

/**
 * 给一个任意 target aspect（不限于 ASPECT_PRESETS）的 scene crop。
 * shell 模式需要按 canvasRect 的实际 aspect 裁场景，所以单拎一层。
 */
export function cropRectForAspect(
  snap: WhiteboardSnapshot | null,
  ctx: Omit<CropContext, 'aspectRatio'>,
  targetAspect: number,
): SceneRect {
  if (ctx.croppingMode === 'fit_all_content') {
    const base = ctx.contentBox ?? ctx.fallbackViewport;
    return containExpand(base, targetAspect);
  }
  // follow_viewport
  const vp = (snap && viewportFromAppState(snap.appState)) ?? ctx.fallbackViewport;
  // 用户框定的裁切框：取视口对应子矩形（窗口本身已是目标比例，无需再 cover-crop）
  if (ctx.cropWindow) {
    const cw = ctx.cropWindow;
    return {
      x: vp.x + cw.rx * vp.width,
      y: vp.y + cw.ry * vp.height,
      width: cw.rw * vp.width,
      height: cw.rh * vp.height,
    };
  }
  return coverCrop(vp, targetAspect);
}

export function cropRectForSnapshot(snap: WhiteboardSnapshot | null, ctx: CropContext): SceneRect {
  const preset = ASPECT_PRESETS[ctx.aspectRatio];
  return cropRectForAspect(snap, ctx, preset.width / preset.height);
}

/**
 * 兜底视口：当 snapshot 没有 width/height 时使用的合理矩形。
 */
export const DEFAULT_FALLBACK_VIEWPORT: SceneRect = {
  x: 0, y: 0, width: 1280, height: 720,
};
