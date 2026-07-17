'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { SubtitleOverlay } from '@/components/SubtitleOverlay';
import { I } from '@/components/icons';
import { cameraPositionAt } from '@/services/exportPipeline';
import { drawLaserOverlay } from '@/utils/laserRender';
import type { CameraPositionEvent, LaserEvent, WhiteboardSnapshot } from '@/types/recording';

const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div> },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

interface SceneBounds { minX: number; minY: number; maxX: number; maxY: number; }

/**
 * 录制全程所有元素的并集包围盒（最多采样 ~40 帧以控成本）。用于回放时把内容
 * fit 进任意尺寸的容器 —— 设备无关，桌面/平板/手机统一适配。
 */
function computeContentBounds(snaps: WhiteboardSnapshot[]): SceneBounds | null {
  if (snaps.length === 0) return null;
  const step = Math.max(1, Math.floor(snaps.length / 40));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (snap: WhiteboardSnapshot) => {
    for (const el of (snap.elements as Array<Record<string, unknown>>)) {
      if ((el as { isDeleted?: boolean }).isDeleted) continue;
      const x = Number(el.x), y = Number(el.y);
      const w = Number(el.width) || 0, h = Number(el.height) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }
  };
  for (let i = 0; i < snaps.length; i += step) consider(snaps[i]);
  consider(snaps[snaps.length - 1]);
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/** 把内容包围盒按容器尺寸 contain-fit，返回 Excalidraw 的 {zoom, scrollX, scrollY}。 */
function fitView(
  bounds: SceneBounds,
  containerW: number,
  containerH: number,
): { zoom: number; scrollX: number; scrollY: number } | null {
  const pad = 32;
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  if (bw <= 0 || bh <= 0 || containerW <= 0 || containerH <= 0) return null;
  let zoom = Math.min((containerW - pad * 2) / bw, (containerH - pad * 2) / bh);
  zoom = Math.max(0.05, Math.min(zoom, 2));
  const bcx = bounds.minX + bw / 2;
  const bcy = bounds.minY + bh / 2;
  // screen = (scene + scroll) * zoom（与 laser overlay 的换算一致）
  const scrollX = containerW / (2 * zoom) - bcx;
  const scrollY = containerH / (2 * zoom) - bcy;
  return { zoom, scrollX, scrollY };
}

function snapshotAt(snaps: WhiteboardSnapshot[], t: number): WhiteboardSnapshot | null {
  if (snaps.length === 0) return null;
  let lo = 0, hi = snaps.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].timestamp <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans === -1 ? snaps[0] : snaps[ans];
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export interface SharedPlayerProps {
  durationMs: number;
  subtitleSrt?: string | null;
  snapshots: WhiteboardSnapshot[];
  audioSrc: string | null;
  cameraSrc: string | null;
  cameraEvents: CameraPositionEvent[];
  /** 录制时采集的激光笔轨迹；为空表示该录制没用过激光，不画 overlay。 */
  laserEvents?: LaserEvent[];
  /** 顶部右侧自定义额外按钮（如 download / delete / dismiss） */
  rightActions?: React.ReactNode;
  /** 标签栏标题 */
  title?: string;
  /** 标签栏左侧返回 */
  backHref?: string;
  /** 是否有音频 / 摄像头的右下角小指示 */
  hasAudio?: boolean;
  hasCamera?: boolean;
  i18n?: {
    play?: string;
    pause?: string;
    audio?: string;
    camera?: string;
    whiteboardOnly?: string;
  };
}

/**
 * 录制库 / 分享链接共用的统一播放器。所有时间相关逻辑：
 *  - 主时钟用 performance.now()（不信任 MediaRecorder 分片 webm 的 currentTime）
 *  - 摄像头气泡按 cameraEvents 跟随时间动态定位
 *  - audio/camera 漂移 > 0.3s 时回写 currentTime
 */
export function SharedPlayer({
  durationMs,
  subtitleSrt,
  snapshots,
  audioSrc,
  cameraSrc,
  cameraEvents,
  laserEvents,
  rightActions,
  title,
  backHref,
  hasAudio,
  hasCamera,
  i18n,
}: SharedPlayerProps): JSX.Element {
  const labels = {
    play: i18n?.play ?? 'Play',
    pause: i18n?.pause ?? 'Pause',
    audio: i18n?.audio ?? 'Audio',
    camera: i18n?.camera ?? 'Camera',
    whiteboardOnly: i18n?.whiteboardOnly ?? 'Whiteboard only',
  };

  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastAppliedTsRef = useRef<number>(-1);
  const clockRef = useRef<{ perfStart: number; baseTime: number } | null>(null);

  // 激光 overlay：和 Excalidraw 容器同尺寸的 absolute canvas，pointer-events: none
  const stageRef = useRef<HTMLDivElement | null>(null);
  const laserCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const timeMsRef = useRef(0);
  timeMsRef.current = timeMs;

  // 设备无关自适应：用内容包围盒 + 容器实测尺寸算出固定的回放视图变换，
  // 丢弃录制时的桌面 scrollX/scrollY/zoom（否则小屏内容会被推到屏外 → 空白）。
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);
  const contentBounds = useMemo(() => computeContentBounds(snapshots), [snapshots]);
  const view = useMemo(
    () => (contentBounds && stageSize ? fitView(contentBounds, stageSize.w, stageSize.h) : null),
    [contentBounds, stageSize],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const applySnapshot = useCallback((t: number) => {
    if (!apiRef.current) return;
    const snap = snapshotAt(snapshots, t);
    if (!snap) return;
    if (snap.timestamp === lastAppliedTsRef.current) return;
    lastAppliedTsRef.current = snap.timestamp;
    try {
      const appState = { ...(snap.appState as Record<string, unknown>) };
      delete appState.collaborators;
      delete appState.activeTool;
      delete appState.viewModeEnabled;
      delete appState.zenModeEnabled;
      // 覆盖为自适应视图（保证任意尺寸下都能看到内容且回放中不抖动）
      const v = viewRef.current;
      if (v) {
        appState.scrollX = v.scrollX;
        appState.scrollY = v.scrollY;
        appState.zoom = { value: v.zoom };
      }
      apiRef.current.updateScene({
        elements: snap.elements,
        appState,
      });
    } catch (e) {
      console.error('updateScene_failed', e);
    }
  }, [snapshots]);

  // 视图变换变化（容器尺寸变化 / 内容就绪）→ 重新套用当前帧
  useEffect(() => {
    if (!view || !apiRef.current) return;
    lastAppliedTsRef.current = -1;
    applySnapshot(timeMsRef.current);
  }, [view, applySnapshot]);

  useEffect(() => {
    if (apiRef.current && snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clockRef.current = null;
      return;
    }
    clockRef.current = { perfStart: performance.now(), baseTime: timeMs };
    const audio = audioRef.current;
    const camera = cameraRef.current;
    const tick = () => {
      const ref = clockRef.current;
      if (!ref) return;
      const t = ref.baseTime + (performance.now() - ref.perfStart);
      if (durationMs > 0 && t >= durationMs) {
        setTimeMs(durationMs);
        applySnapshot(durationMs);
        setPlaying(false);
        if (audio) { try { audio.pause(); } catch { /* ignore */ } }
        if (camera) { try { camera.pause(); } catch { /* ignore */ } }
        return;
      }
      setTimeMs(t);
      applySnapshot(t);
      const tSec = t / 1000;
      if (audio && isFinite(audio.currentTime) && Math.abs(audio.currentTime - tSec) > 0.3) {
        try { audio.currentTime = tSec; } catch { /* ignore */ }
      }
      if (camera && isFinite(camera.currentTime) && Math.abs(camera.currentTime - tSec) > 0.3) {
        try { camera.currentTime = tSec; } catch { /* ignore */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, applySnapshot, durationMs]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      const camera = cameraRef.current;
      if (next) {
        const restart = durationMs > 0 && timeMs >= durationMs - 50;
        const startT = restart ? 0 : timeMs;
        if (restart) {
          setTimeMs(0);
          lastAppliedTsRef.current = -1;
        }
        if (audio) {
          try { audio.currentTime = startT / 1000; } catch { /* ignore */ }
          void audio.play().catch(() => { /* user-gesture lost */ });
        }
        if (camera) {
          try { camera.currentTime = startT / 1000; } catch { /* ignore */ }
          void camera.play().catch(() => { /* ignore */ });
        }
      } else {
        if (audio) audio.pause();
        if (camera) camera.pause();
      }
      return next;
    });
  }, [durationMs, timeMs]);

  const handleSeek = useCallback((t: number) => {
    setTimeMs(t);
    lastAppliedTsRef.current = -1;
    applySnapshot(t);
    const audio = audioRef.current;
    const camera = cameraRef.current;
    if (audio) { try { audio.currentTime = t / 1000; } catch { /* ignore */ } }
    if (camera) { try { camera.currentTime = t / 1000; } catch { /* ignore */ } }
    if (playing) {
      clockRef.current = { perfStart: performance.now(), baseTime: t };
    }
  }, [applySnapshot, playing]);

  const onApi = useCallback((api: ExcalidrawAPI) => {
    apiRef.current = api;
    if (snapshots.length > 0) {
      lastAppliedTsRef.current = -1;
      applySnapshot(0);
    }
  }, [snapshots, applySnapshot]);

  // 激光 overlay：把 canvas 像素尺寸同步到 stage（CSS px × devicePixelRatio）
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = laserCanvasRef.current;
    if (!stage || !canvas) return;
    const sync = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 把容器尺寸喂给自适应视图（旋转屏幕/改窗口/地址栏收起都会触发）
      setStageSize((prev) =>
        prev && prev.w === rect.width && prev.h === rect.height
          ? prev
          : { w: rect.width, h: rect.height },
      );
    };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(stage);
    return () => obs.disconnect();
  }, []);

  // 激光 overlay：每次 timeMs 变化（含 RAF 推动、seek、暂停）重画一次
  useLayoutEffect(() => {
    const canvas = laserCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    ctx.clearRect(0, 0, cssW, cssH);
    if (!laserEvents || laserEvents.length === 0) return;
    // 与画布同一套自适应视图变换（fit-to-container），保证激光轨迹对齐
    const v = viewRef.current;
    let zoomVal: number, scrollX: number, scrollY: number;
    if (v) {
      zoomVal = v.zoom; scrollX = v.scrollX; scrollY = v.scrollY;
    } else {
      const snap = snapshotAt(snapshots, timeMs);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ast = (snap?.appState ?? {}) as any;
      zoomVal = (typeof ast.zoom === 'object' && ast.zoom && typeof ast.zoom.value === 'number')
        ? ast.zoom.value
        : (typeof ast.zoom === 'number' ? ast.zoom : 1);
      scrollX = typeof ast.scrollX === 'number' ? ast.scrollX : 0;
      scrollY = typeof ast.scrollY === 'number' ? ast.scrollY : 0;
    }
    drawLaserOverlay(ctx, laserEvents, timeMs, {
      sceneToScreen: (sx: number, sy: number) => ({
        x: (sx + scrollX) * zoomVal,
        y: (sy + scrollY) * zoomVal,
      }),
    });
  }, [timeMs, laserEvents, snapshots]);

  const ready = snapshots.length > 0 || durationMs > 0;

  return (
    <div className="player-craft-surface flex flex-1 flex-col overflow-hidden">
      {(title || backHref || rightActions) && (
        <div
          className="player-craft-toolbar flex items-center gap-3 px-6 py-3"
          style={{ background: 'var(--paper)', borderBottom: '1.5px solid var(--ink)' }}
        >
          {backHref && (
            <a
              href={backHref}
              aria-label="back"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                border: '1.4px solid var(--ink)',
                background: 'var(--paper)',
                borderRadius: 3,
                color: 'var(--ink)',
              }}
            >
              <I.ChevronLeft size={14} />
            </a>
          )}
          {title && (
            <div
              className="truncate"
              style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              {title}
            </div>
          )}
          <div className="flex-1" />
          {rightActions}
        </div>
      )}

      <div ref={stageRef} className="player-craft-stage relative flex-1 bg-canvas-bg">
        <Excalidraw
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          excalidrawAPI={onApi as any}
          viewModeEnabled
          zenModeEnabled
        />
        <canvas
          ref={laserCanvasRef}
          className="pointer-events-none absolute inset-0 z-30"
          aria-hidden
        />
        <SubtitleOverlay srt={subtitleSrt} timeMs={timeMs} />
        {cameraSrc && (
          <SharedCameraBubble
            src={cameraSrc}
            cameraEvents={cameraEvents}
            timeMs={timeMs}
            playing={playing}
            videoRef={cameraRef}
          />
        )}
        {audioSrc && (
          <audio
            ref={audioRef}
            src={audioSrc}
            preload="auto"
            hidden
          />
        )}
        {!ready && (
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              background: 'rgba(26,26,26,0.05)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--ink-3)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            loading…
          </div>
        )}
      </div>

      <div
        className="player-craft-controls px-6 py-4"
        style={{ background: 'var(--paper)', borderTop: '1.5px solid var(--ink)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!ready || durationMs === 0}
            className="player-craft-play grid place-items-center transition"
            style={{
              width: 40,
              height: 40,
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1.6px solid var(--ink)',
              boxShadow: '3px 3px 0 var(--hi)',
              borderRadius: 999,
              cursor: !ready || durationMs === 0 ? 'not-allowed' : 'pointer',
              opacity: !ready || durationMs === 0 ? 0.4 : 1,
            }}
            aria-label={playing ? labels.pause : labels.play}
          >
            {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 600 }}>
            {fmt(timeMs)}
          </span>
          <input
            type="range"
            min={0}
            max={durationMs}
            step={Math.max(1, Math.round((durationMs || 1) / 400))}
            value={Math.min(timeMs, durationMs)}
            onChange={(e) => handleSeek(Number(e.target.value))}
            disabled={!ready || durationMs === 0}
            className="h-1.5 flex-1"
            style={{ accentColor: 'var(--ink)' }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>
            {fmt(durationMs)}
          </span>
          <div
            className="ml-2 flex items-center gap-3"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            {hasAudio && <span className="flex items-center gap-1"><I.Mic size={12} /> {labels.audio}</span>}
            {hasCamera && <span className="flex items-center gap-1"><I.Camera size={12} /> {labels.camera}</span>}
            {!hasAudio && !hasCamera && <span>{labels.whiteboardOnly}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SharedCameraBubble({
  src,
  cameraEvents,
  timeMs,
  playing,
  videoRef,
}: {
  src: string;
  cameraEvents: CameraPositionEvent[];
  timeMs: number;
  playing: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
}): JSX.Element {
  const styleAndHidden = useMemo<{ style: React.CSSProperties; hidden: boolean }>(() => {
    const pos = cameraPositionAt(cameraEvents, timeMs);
    if (pos) {
      return {
        style: {
          left: `${pos.rx * 100}%`,
          top: `${pos.ry * 100}%`,
          width: `${pos.rs * 100}%`,
          aspectRatio: '1 / 1',
        },
        hidden: pos.hidden,
      };
    }
    return {
      style: { right: 24, bottom: 24, width: 160, height: 160 },
      hidden: false,
    };
  }, [cameraEvents, timeMs]);

  return (
    <div
      className="player-craft-camera-bubble pointer-events-none absolute z-40 overflow-hidden transition-[left,top,width] duration-100"
      style={{
        ...styleAndHidden.style,
        display: styleAndHidden.hidden ? 'none' : undefined,
        borderRadius: '50%',
        background: '#1f2937',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px rgba(255,255,255,0.9)',
      }}
    >
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && !playing) {
            try { v.currentTime = Math.min(0.05, (isFinite(v.duration) ? v.duration : 0.05)); } catch { /* ignore */ }
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
        }}
      />
    </div>
  );
}
