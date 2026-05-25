'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cameraPositionAt, renderPreviewFrame } from '@/services/exportPipeline';
import { getWorkspaceShells, loadFullRecording } from '@/lib/db-client';
import type { CameraPositionEvent, ExportConfig, RecordingMetadata, ShellCanvasRect, ShellSize } from '@/types/recording';
import { ASPECT_PRESETS } from '@/types/recording';
import { I } from '@/components/icons';
import type { ExportProgressState } from '@/components/ExportPanel';

interface Props {
  recordingId: string;
  metadata: RecordingMetadata;
  config: ExportConfig;
  progress?: ExportProgressState | null;
}

// 预览播放时，主帧画面的最小重渲染间隔（ms）。
// renderPreviewFrame 较重（要重放快照 + 走 excalidraw exportToCanvas），
// 这里把它限到 ~5fps，足以让用户感知白板进度，又不会卡 UI。
const CANVAS_REDRAW_INTERVAL_MS = 200;

// 预览盒子尺寸约束 —— 跟 export 页 mx-auto + max-w-760 父容器对齐
const PREVIEW_PARENT_MAX_W = 760;
const PREVIEW_VH_PCT = 0.52;

export function ExportPreview({ recordingId, metadata, config, progress }: Props): JSX.Element {
  const t = useTranslations('exportPreview');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const [timeMs, setTimeMs] = useState<number>(0);
  const [rendering, setRendering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [cameraEvents, setCameraEvents] = useState<CameraPositionEvent[]>([]);
  const [firstShell, setFirstShell] = useState<{ shellSize: ShellSize; canvasRect: ShellCanvasRect } | null>(null);
  const [playing, setPlaying] = useState(false);
  // 视口高度 —— 用来 JS 算盒子尺寸，避免 CSS aspect-ratio + max-* 在部分浏览器不收 width 的坑
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const renderToken = useRef(0);
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef<{ perfStart: number; baseTime: number } | null>(null);
  const lastDrawAtRef = useRef<number>(0);
  const lastDrawTimeMsRef = useRef<number>(-Infinity);

  // 加载 audio / camera blob + 摄像头位置事件，用于预览播放
  useEffect(() => {
    let cancelled = false;
    let createdAudioUrl: string | null = null;
    let createdCameraUrl: string | null = null;
    Promise.all([loadFullRecording(recordingId), getWorkspaceShells(recordingId)])
      .then(([r, shells]) => {
        if (cancelled) return;
        if (r.audioBlob) {
          createdAudioUrl = URL.createObjectURL(r.audioBlob);
          setAudioUrl(createdAudioUrl);
        }
        if (r.cameraBlob) {
          createdCameraUrl = URL.createObjectURL(r.cameraBlob);
          setCameraUrl(createdCameraUrl);
        }
        setCameraEvents(r.cameraEvents);
        if (shells.length > 0) {
          setFirstShell({ shellSize: shells[0].shellSize, canvasRect: shells[0].canvasRect });
        }
      })
      .catch(() => { /* 静默：预览能不能渲染由 renderPreviewFrame 反馈 */ });
    return () => {
      cancelled = true;
      if (createdAudioUrl) URL.revokeObjectURL(createdAudioUrl);
      if (createdCameraUrl) URL.revokeObjectURL(createdCameraUrl);
    };
  }, [recordingId]);

  // 当前 timeMs 对应的摄像头位置（百分比）。
  // shell on 时，气泡定位用 letterboxed shell 区作为坐标系（跟导出 pipeline 一致）；
  // shell off / 无 shell 时，整张预览框作为坐标系。
  const cameraOverlayStyle = useMemo<React.CSSProperties>(() => {
    const preset = ASPECT_PRESETS[config.aspectRatio];
    const useShell = !!firstShell && (config.includeWorkspaceShell ?? true);

    // 把 camBounds 表达成"占整张预览框的比例"，方便用 % 写 CSS。
    let bounds = { offFracX: 0, offFracY: 0, fracW: 1, fracH: 1 };
    if (useShell && firstShell) {
      const s = Math.min(preset.width / firstShell.shellSize.width, preset.height / firstShell.shellSize.height);
      const scaledW = firstShell.shellSize.width * s;
      const scaledH = firstShell.shellSize.height * s;
      bounds = {
        offFracX: (preset.width - scaledW) / 2 / preset.width,
        offFracY: (preset.height - scaledH) / 2 / preset.height,
        fracW: scaledW / preset.width,
        fracH: scaledH / preset.height,
      };
    }

    const pos = cameraPositionAt(cameraEvents, timeMs);
    if (pos) {
      return {
        left: `${(bounds.offFracX + pos.rx * bounds.fracW) * 100}%`,
        top: `${(bounds.offFracY + pos.ry * bounds.fracH) * 100}%`,
        width: `${pos.rs * bounds.fracW * 100}%`,
        // hidden=true（录制时用户软关闭过摄像头）期间不画气泡 —— 跟导出 MP4 一致
        display: pos.hidden ? 'none' : undefined,
      };
    }
    // legacy fallback：camBounds 右下角，宽度约 18% of bounds
    const w = bounds.fracW * 0.18;
    return {
      left: `${(bounds.offFracX + bounds.fracW * (1 - 0.18) - bounds.fracW * 0.025) * 100}%`,
      top: `${(bounds.offFracY + bounds.fracH * (1 - 0.18) - bounds.fracH * 0.04) * 100}%`,
      width: `${w * 100}%`,
    };
  }, [cameraEvents, timeMs, firstShell, config.aspectRatio, config.includeWorkspaceShell]);

  // 帧渲染：节流到 CANVAS_REDRAW_INTERVAL_MS。静态 scrub 时立即重绘。
  const drawFrame = useCallback((t: number, force: boolean) => {
    if (!canvasRef.current) return;
    const now = performance.now();
    if (!force && now - lastDrawAtRef.current < CANVAS_REDRAW_INTERVAL_MS) return;
    if (!force && Math.abs(t - lastDrawTimeMsRef.current) < CANVAS_REDRAW_INTERVAL_MS / 2) return;
    lastDrawAtRef.current = now;
    lastDrawTimeMsRef.current = t;
    const my = ++renderToken.current;
    setRendering(true);
    setError(null);
    renderPreviewFrame(recordingId, t, config, canvasRef.current)
      .catch((err) => { if (renderToken.current === my) setError(err instanceof Error ? err.message : 'render_failed'); })
      .finally(() => { if (renderToken.current === my) setRendering(false); });
  }, [recordingId, config]);

  // 当 timeMs / config 变化时重绘（force=true 用于 scrub / config 切换）
  useEffect(() => {
    drawFrame(timeMs, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, config]);

  // 播放循环：performance.now() 主时钟 + 节流 canvas 重绘
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
      const dur = metadata.durationMs;
      if (dur > 0 && t >= dur) {
        setTimeMs(dur);
        drawFrame(dur, true);
        setPlaying(false);
        if (audio) { try { audio.pause(); } catch { /* ignore */ } }
        if (camera) { try { camera.pause(); } catch { /* ignore */ } }
        return;
      }
      setTimeMs(t);
      drawFrame(t, false);
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
  }, [playing, drawFrame, metadata.durationMs]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      const camera = cameraRef.current;
      const dur = metadata.durationMs;
      if (next) {
        const restart = dur > 0 && timeMs >= dur - 50;
        const startT = restart ? 0 : timeMs;
        if (restart) {
          setTimeMs(0);
          drawFrame(0, true);
        }
        if (audio) {
          try { audio.currentTime = startT / 1000; } catch { /* ignore */ }
          void audio.play().catch(() => { /* ignore */ });
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
  }, [metadata.durationMs, timeMs, drawFrame]);

  const handleSeek = useCallback((t: number) => {
    setTimeMs(t);
    drawFrame(t, true);
    const audio = audioRef.current;
    const camera = cameraRef.current;
    if (audio) { try { audio.currentTime = t / 1000; } catch { /* ignore */ } }
    if (camera) { try { camera.currentTime = t / 1000; } catch { /* ignore */ } }
    if (playing) {
      clockRef.current = { perfStart: performance.now(), baseTime: t };
    }
  }, [drawFrame, playing]);

  const preset = ASPECT_PRESETS[config.aspectRatio];
  const aspect = preset.width / preset.height;

  // contain-fit 计算盒子像素尺寸 —— 优先吃 maxW，溢出高度再退到 maxH。
  const previewBox = useMemo(() => {
    const maxH = viewportH * PREVIEW_VH_PCT;
    const maxW = PREVIEW_PARENT_MAX_W;
    if (maxW / aspect <= maxH) {
      return { w: maxW, h: maxW / aspect };
    }
    return { w: maxH * aspect, h: maxH };
  }, [aspect, viewportH]);

  const exporting = progress != null;
  const pct = exporting ? Math.round((progress?.ratio ?? 0) * 100) : 0;
  const phaseKey = progress?.phase ?? '';
  const phaseLabel = useMemo(() => {
    if (!exporting) return '';
    try {
      return t(`phase.${phaseKey}` as never);
    } catch {
      return phaseKey;
    }
  }, [exporting, phaseKey, t]);

  // 摄像头气泡位置/尺寸由 cameraOverlayStyle 计算（events → 动态；无事件 → 右下角 18% 宽度）

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto overflow-hidden"
        style={{
          // 直接用 JS 算出来的像素尺寸，绕开 CSS aspect-ratio + max-* 三件套
          // 在某些浏览器下不能同步收 width 的坑 —— 进度条、canvas、摄像头叠加层
          // 都跟这个盒子尺寸走。
          width: previewBox.w,
          height: previewBox.h,
          background: 'var(--paper)',
          border: '1.5px solid var(--ink)',
          borderRadius: 3,
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
        />

        {/* 摄像头气泡：位置/尺寸跟随 cameraEvents（无事件时回退右下角） */}
        {cameraUrl && (
          <div
            className="pointer-events-none absolute z-30 overflow-hidden transition-[left,top,width] duration-100"
            style={{
              ...cameraOverlayStyle,
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              background: '#1f2937',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.9)',
            }}
          >
            <video
              ref={cameraRef}
              src={cameraUrl}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                const v = cameraRef.current;
                if (v && !playing) {
                  try { v.currentTime = Math.min(0.05, isFinite(v.duration) ? v.duration : 0.05); } catch { /* ignore */ }
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
        )}

        {/* 隐藏音频元素，仅用于预览播放 */}
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            hidden
          />
        )}

        <div
          className="absolute left-3 top-3 flex items-center gap-1.5"
          style={{
            padding: '3px 10px',
            background: config.withWatermark ? 'var(--hi)' : 'var(--pro)',
            border: '1.2px solid var(--ink)',
            borderRadius: 999,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
          }}
        >
          {config.withWatermark ? t('watermarkBadge') : t('cleanBadge')}
        </div>

        {rendering && !exporting && !playing && (
          <span
            className="absolute right-3 top-3"
            style={{
              padding: '2px 8px',
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.04em',
              borderRadius: 2,
            }}
          >
            {t('renderingTag')}
          </span>
        )}
        {error && (
          <span
            className="absolute inset-x-3 top-12"
            style={{
              padding: '6px 12px',
              background: 'var(--rec)',
              color: 'var(--paper)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              borderRadius: 3,
              border: '1.3px solid var(--ink)',
            }}
          >
            {t('previewFailed', { message: error })}
          </span>
        )}

        {!exporting && (
          <div
            className="absolute inset-x-4 bottom-3 flex items-center gap-3"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              padding: '6px 10px 6px 6px',
              borderRadius: 3,
              border: '1.3px solid var(--ink)',
            }}
          >
            <button
              type="button"
              onClick={togglePlay}
              disabled={metadata.durationMs === 0}
              className="grid place-items-center"
              style={{
                width: 26,
                height: 26,
                background: 'var(--hi)',
                color: 'var(--ink)',
                border: '1.2px solid var(--paper)',
                borderRadius: 999,
                cursor: metadata.durationMs === 0 ? 'not-allowed' : 'pointer',
                opacity: metadata.durationMs === 0 ? 0.5 : 1,
                flexShrink: 0,
              }}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <I.Pause size={11} /> : <I.Play size={11} />}
            </button>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {(timeMs / 1000).toFixed(1)}s
            </span>
            <input
              type="range"
              min={0}
              max={metadata.durationMs}
              step={Math.max(1, Math.round(metadata.durationMs / 400))}
              value={Math.min(timeMs, metadata.durationMs)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="h-1 flex-1"
              style={{ accentColor: 'var(--hi)' }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {(metadata.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}

        {exporting && (
          <div
            className="fade-in absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(26, 26, 26, 0.55)' }}
          >
            <div
              className="w-[80%] max-w-[340px] px-5 py-4"
              style={{
                background: 'var(--paper)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '4px 4px 0 var(--ink)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 flex-shrink-0">
                  <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--rule-soft)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="var(--ink)"
                      strokeWidth="3"
                      strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dasharray 200ms' }}
                    />
                  </svg>
                  <span
                    className="absolute inset-0 grid place-items-center tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--ink)' }}
                  >
                    {pct}%
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.005em' }}>
                    {t('generating')}
                  </div>
                  <div
                    className="mt-0.5 truncate"
                    style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
                  >
                    {phaseLabel}
                  </div>
                </div>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden"
                style={{ background: 'var(--paper-3)', border: '1px solid var(--ink)', borderRadius: 999 }}
              >
                <div
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, background: 'var(--hi)' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <p
        style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}
      >
        {t('caption')}
      </p>
    </div>
  );
}
