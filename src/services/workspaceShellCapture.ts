'use client';

import { toPng } from 'html-to-image';
import { appendWorkspaceShell } from '@/lib/db-client';
import type { ShellCanvasRect, ShellSize } from '@/types/recording';

const NO_RECORD_CLASS = 'rb-no-record';

const PERIODIC_INTERVAL_MS = 5000;
const CAPTURE_TIMEOUT_MS = 1200;
const MIN_CAPTURE_GAP_MS = 1500;       // 两次抓取至少间隔，防止 chrome 抖动连击 + 降低录制中主线程占用
const APPSTATE_DEBOUNCE_MS = 1000;     // appState 连续变化停止后再抓（也把指纹计算推迟到此刻）
const SCROLL_ZOOM_DEDUP_EPS = 0.04;    // zoom 差 < 4%、scroll 差 < 4% 视为同一帧

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('invalid_data_url');
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

const CHROME_KEYS = [
  'selectedElementIds',
  'activeTool',
  'openSidebar',
  'openMenu',
  'openPopup',
  'theme',
  'gridSize',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemStrokeWidth',
  'currentItemRoughness',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemRoundness',
  'currentItemFillStyle',
  'currentItemStrokeStyle',
  'currentItemOpacity',
];

function activeToolValue(t: unknown): string | null {
  if (!t || typeof t !== 'object') return null;
  const obj = t as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  const lockedKey = typeof obj.locked === 'boolean' ? `:locked=${obj.locked}` : '';
  return `${type}${lockedKey}`;
}

function chromeFingerprint(appState: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of CHROME_KEYS) {
    const v = appState[key];
    if (key === 'activeTool') {
      parts.push(`activeTool=${activeToolValue(v)}`);
      continue;
    }
    if (key === 'selectedElementIds') {
      const ids = v && typeof v === 'object' ? Object.keys(v as object).sort().join(',') : '';
      parts.push(`sel=${ids}`);
      continue;
    }
    if (v == null) parts.push(`${key}=`);
    else if (typeof v === 'object') parts.push(`${key}=${JSON.stringify(v)}`);
    else parts.push(`${key}=${String(v)}`);
  }
  // Zoom + scroll bucketed coarsely (workspace bottom-left shows zoom %)
  const zoomRaw = (appState.zoom as { value?: number } | number | undefined);
  const zoom = typeof zoomRaw === 'object' && zoomRaw ? Number(zoomRaw.value ?? 1) : Number(zoomRaw ?? 1);
  parts.push(`zoom=${Math.round(zoom * 25) / 25}`);
  // 不把 scroll 包进 fingerprint —— 滚动是高频事件，会刷爆快照
  return parts.join('|');
}

async function pngHash(blob: Blob): Promise<string> {
  // 简易 hash：size + 前 1024 字节 sha-256 hex 前 16 位。两者相同视为重复。
  const head = blob.slice(0, 1024);
  const buf = await head.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += view[i].toString(16).padStart(2, '0');
  return `${blob.size}-${hex}`;
}

function findCanvasRect(root: HTMLElement): ShellCanvasRect | null {
  // Excalidraw 在容器内渲染 <canvas>，取最大那块（通常是 staticCanvas）
  const canvases = Array.from(root.querySelectorAll('canvas'));
  if (canvases.length === 0) return null;
  let largest: HTMLCanvasElement | null = null;
  let largestArea = 0;
  const rootRect = root.getBoundingClientRect();
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > largestArea) {
      largestArea = area;
      largest = c;
    }
  }
  if (!largest) return null;
  const r = largest.getBoundingClientRect();
  return {
    x: Math.round(r.left - rootRect.left),
    y: Math.round(r.top - rootRect.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function shellSize(root: HTMLElement): ShellSize {
  const r = root.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
}

interface CapturerOptions {
  recordingId: string;
  rootEl: HTMLElement;
  getElapsedMs: () => number;
  isPaused: () => boolean;
}

export class ShellCapturer {
  private readonly opts: CapturerOptions;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private capturing = false;
  private stopped = false;
  private lastHash: string | null = null;
  private lastFingerprint: string | null = null;
  private lastCaptureAt = 0;

  constructor(opts: CapturerOptions) {
    this.opts = opts;
  }

  start(): void {
    // 立即抓首张
    void this.captureNow();
    this.intervalHandle = setInterval(() => {
      if (this.stopped || this.opts.isPaused()) return;
      void this.captureNow();
    }, PERIODIC_INTERVAL_MS);
  }

  onAppStateChange(appState: Record<string, unknown>): void {
    if (this.stopped || this.opts.isPaused()) return;
    // 不在每次 onChange 同步算指纹（chromeFingerprint 含 JSON.stringify，频繁调用拖慢绘制）；
    // 先防抖，等连续变化停止后只算一次指纹再决定是否抓图。
    this.pendingAppState = appState;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.stopped || this.opts.isPaused() || !this.pendingAppState) return;
      const fp = chromeFingerprint(this.pendingAppState);
      if (fp === this.lastFingerprint) return;
      this.lastFingerprint = fp;
      void this.captureNow();
    }, APPSTATE_DEBOUNCE_MS);
  }

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAppState: Record<string, unknown> | null = null;

  stop(): void {
    this.stopped = true;
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.intervalHandle = null;
    this.debounceTimer = null;
  }

  private async captureNow(): Promise<void> {
    if (this.stopped || this.capturing) return;
    const now = Date.now();
    if (now - this.lastCaptureAt < MIN_CAPTURE_GAP_MS) return;
    this.capturing = true;
    this.lastCaptureAt = now;
    try {
      const t = this.opts.getElapsedMs();
      // 高分采集：2× 像素让高分辨率导出（含 4K）时外壳更锐；长边超 4K 时下调避免 OOM。
      // 导出无法补采集时丢失的细节，故录制端一律采足够高（见 plan「录制端一律高采集」）。
      const rect = this.opts.rootEl.getBoundingClientRect();
      const longSide = Math.max(1, rect.width, rect.height);
      const pr = Math.max(1, Math.min(2, 3840 / longSide));
      const dataUrl = await Promise.race([
        toPng(this.opts.rootEl, {
          cacheBust: false,
          pixelRatio: pr,
          filter: (node) => {
            // 过滤掉录制条 / 摄像头 / 用 rb-no-record 标记的节点
            if (!(node instanceof Element)) return true;
            if (node.classList?.contains?.(NO_RECORD_CLASS)) return false;
            return true;
          },
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('shell_capture_timeout')), CAPTURE_TIMEOUT_MS),
        ),
      ]);
      const blob = dataUrlToBlob(dataUrl);
      const hash = await pngHash(blob);
      if (hash === this.lastHash) return; // dedupe
      this.lastHash = hash;
      const canvasRect = findCanvasRect(this.opts.rootEl);
      if (!canvasRect) return; // 没有 Excalidraw canvas，跳过
      const size = shellSize(this.opts.rootEl);
      await appendWorkspaceShell({
        recordingId: this.opts.recordingId,
        timestamp: t,
        png: blob,
        canvasRect,
        shellSize: size,
        hash,
      });
    } catch {
      // 静默失败 —— shell capture 是 best-effort，不该影响录制
    } finally {
      this.capturing = false;
    }
  }
}

export { NO_RECORD_CLASS };
