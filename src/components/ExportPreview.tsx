'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { autoZoomAt, cameraPositionAt, getRecordingWindowRect, releasePreviewResources, renderPreviewFrame, setPreviewPlayback } from '@/services/exportPipeline';
import { cameraPlacementFromEvent, projectCameraPlacement } from '@/services/cameraPlacement';
import { getEnhancedAudioTrack, getLocalizedTrack, getWorkspaceShells, loadFullRecording, releaseRecordingMediaCache } from '@/lib/db-client';
import { isUsableLocalizedTrack } from '@/lib/localizedTrack';
import { audioSourceFingerprint } from '@/services/audioEnhancement';
import type { AutoZoomSegment, CameraPositionEvent, EnhancedAudioTrack, ExportConfig, HighlightEffectSegment, LocalizedTrack, RecordingMetadata, ShellCanvasRect, ShellSize, TimeSegment } from '@/types/recording';
import { resolveExportOutputSize } from '@/types/recording';
import { keptDuration, normalizeSegments, outputToSource, sourceToOutput } from '@/utils/segments';
import { I } from '@/components/icons';
import { analyzeCursorFocusTrack } from '@/services/cursorFocusTracker';
import { LatestTaskRunner } from '@/lib/latestTaskRunner';
import { resolvePreviewRenderSize } from '@/services/previewRenderPolicy';
import { getVideoBackgroundPreset, resolveVideoBackground } from '@/config/videoBackgrounds';
import { useMediaTaskActions } from '@/components/providers/MediaTaskProvider';
import { announceMediaTaskCreated } from '@/components/MediaTaskCenter';

interface Props {
  recordingId: string;
  metadata: RecordingMetadata;
  config: ExportConfig;
  /** 保留段（源 ms）；播放 / 读数走「成片」时间，跳过被删段。 */
  segments: TimeSegment[];
  /** 受控播放头（源 ms）。 */
  playheadMs: number;
  onPlayheadChange: (srcMs: number) => void;
  /** 时间轴当前选中的 Auto Zoom；在预览中以可拖动框呈现最终放大区域。 */
  selectedAutoZoomId?: string | null;
  onAutoZoomRegionChange?: (id: string, patch: Partial<Pick<AutoZoomSegment, 'scale' | 'cx' | 'cy'>>) => void;
  selectedHighlightId?: string | null;
  onHighlightRegionChange?: (id: string, region: HighlightEffectSegment['region']) => void;
}

const DISPLAY_REDRAW_INTERVAL_MS = 50;
const WHITEBOARD_REDRAW_INTERVAL_MS = 100;

const PREVIEW_MIN_WIDTH = 300;
const PREVIEW_MIN_HEIGHT = 180;
const PREVIEW_MAX_HEIGHT = 900;
const PREVIEW_PREFERRED_WIDTH = 860;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const resizeButtonStyle: React.CSSProperties = {
  display: 'grid',
  width: 24,
  height: 24,
  placeItems: 'center',
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--font-mono)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
};

export function ExportPreview({
  recordingId, metadata, config, segments, playheadMs, onPlayheadChange,
  selectedAutoZoomId = null, onAutoZoomRegionChange,
  selectedHighlightId = null, onHighlightRegionChange,
}: Props): JSX.Element {
  const t = useTranslations('exportPreview');
  const { startTask } = useMediaTaskActions();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  // 受控播放头（源时间）。播放/读数走「成片」输出时间（跳过被删段）。
  const timeMs = playheadMs;
  const setTimeMs = onPlayheadChange;
  const kept = useMemo(() => normalizeSegments(segments, metadata.durationMs), [segments, metadata.durationMs]);
  const keptDur = useMemo(() => keptDuration(kept), [kept]);
  const [rendering, setRendering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [sourceAudioFingerprint, setSourceAudioFingerprint] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [localizedTrack, setLocalizedTrack] = useState<LocalizedTrack | null>(null);
  const [localizedAudioUrl, setLocalizedAudioUrl] = useState<string | null>(null);
  const [localizedCameraUrl, setLocalizedCameraUrl] = useState<string | null>(null);
  const [enhancedAudioTrack, setEnhancedAudioTrack] = useState<EnhancedAudioTrack | null>(null);
  const [enhancedAudioUrl, setEnhancedAudioUrl] = useState<string | null>(null);
  const [cameraEvents, setCameraEvents] = useState<CameraPositionEvent[]>([]);
  const previewStageBackground = useMemo(() => {
    const background = resolveVideoBackground(config.videoBackground);
    if (background.kind === 'color') return background.color ?? '#fffdf8';
    if (background.kind === 'preset') {
      const preset = getVideoBackgroundPreset(background.presetId);
      if (preset) return `url(${JSON.stringify(preset.asset)}) center / cover no-repeat #202426`;
    }
    return '#202426';
  }, [config.videoBackground]);
  const [firstShell, setFirstShell] = useState<{ shellSize: ShellSize; canvasRect: ShellCanvasRect } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectionOverlaysHidden, setSelectionOverlaysHidden] = useState(false);
  const [cursorTracking, setCursorTracking] = useState<{
    progress: number;
    quality?: 'good' | 'partial' | 'poor';
    failed?: boolean;
  } | null>(null);
  const [focusTrackRevision, setFocusTrackRevision] = useState(0);
  // 预览高度是用户控制的稳定尺寸。切换比例只按 height * aspect 改变宽度，
  // 直到用户再次通过按钮或拖拽调整高度。
  const parentRef = useRef<HTMLDivElement>(null);
  const [parentWidth, setParentWidth] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [requestedHeight, setRequestedHeight] = useState<number | null>(null);

  // useLayoutEffect：挂载/重渲染后、浏览器 paint 前同步读宽度，避免首帧 0 宽闪烁
  // 把 config.aspectRatio 放进依赖：每次切换比例都强制重新测量一次父宽（兜底
  // ResizeObserver 在内容尺寸"等于上次值"时部分浏览器跳过的边界 case）。
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      setParentWidth(el.clientWidth);
      const editorViewport = el.closest<HTMLElement>('.editor-craft-main');
      setEditorViewportHeight(editorViewport?.clientHeight ?? window.innerHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const editorViewport = el.closest<HTMLElement>('.editor-craft-main');
    if (editorViewport) ro.observe(editorViewport);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [config.aspectRatio]);
  const mountedRef = useRef(true);
  const renderConfigRef = useRef(config);
  const renderRecordingIdRef = useRef(recordingId);
  const renderMetadataRef = useRef(metadata);
  renderConfigRef.current = config;
  renderRecordingIdRef.current = recordingId;
  renderMetadataRef.current = metadata;
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef<{ perfStart: number; baseTime: number } | null>(null);
  const lastDrawAtRef = useRef<number>(0);
  const lastDrawTimeMsRef = useRef<number>(-Infinity);
  const renderRunnerRef = useRef<LatestTaskRunner<number> | null>(null);
  if (!renderRunnerRef.current) {
    renderRunnerRef.current = new LatestTaskRunner<number>(async (requestedTimeMs, signal) => {
      if (!mountedRef.current) return;
      const visible = canvasRef.current;
      if (!visible) return;
      setRendering(true);
      setError(null);
      const renderCanvas = renderCanvasRef.current ?? document.createElement('canvas');
      renderCanvasRef.current = renderCanvas;
      try {
        if (signal.aborted) return;
        const composition = resolveExportOutputSize(renderConfigRef.current);
        const renderSize = resolvePreviewRenderSize({
          compositionWidth: composition.width,
          compositionHeight: composition.height,
          displayWidth: visible.clientWidth,
          displayHeight: visible.clientHeight,
          devicePixelRatio: window.devicePixelRatio,
        });
        await renderPreviewFrame(
          renderRecordingIdRef.current,
          requestedTimeMs,
          renderConfigRef.current,
          renderCanvas,
          renderMetadataRef.current,
          renderSize,
          signal,
        );
        if (signal.aborted || !mountedRef.current || !canvasRef.current) return;
        visible.width = renderCanvas.width;
        visible.height = renderCanvas.height;
        visible.getContext('2d')?.drawImage(renderCanvas, 0, 0);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (mountedRef.current) setError(err instanceof Error ? err.message : 'render_failed');
      } finally {
        if (mountedRef.current) setRendering(false);
      }
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releasePreviewResources(recordingId);
      releaseRecordingMediaCache(recordingId);
    };
  }, [recordingId]);

  useEffect(() => {
    void setPreviewPlayback(recordingId, playing, timeMs).catch(() => undefined);
    return () => { void setPreviewPlayback(recordingId, false, timeMs).catch(() => undefined); };
    // timeMs intentionally captures the start position; the media clock advances afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, recordingId]);

  // 加载 audio / camera blob + 摄像头位置事件，用于预览播放
  useEffect(() => {
    let cancelled = false;
    let createdAudioUrl: string | null = null;
    let createdCameraUrl: string | null = null;
    setAudioUrl(null);
    setSourceAudioFingerprint(null);
    setCameraUrl(null);
    Promise.all([loadFullRecording(recordingId), getWorkspaceShells(recordingId)])
      .then(([r, shells]) => {
        if (cancelled) return;
        if (r.audioBlob) {
          createdAudioUrl = URL.createObjectURL(r.audioBlob);
          setAudioUrl(createdAudioUrl);
          setSourceAudioFingerprint(audioSourceFingerprint(r.audioBlob, r.metadata.durationMs));
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

  useEffect(() => {
    let cancelled = false;
    if (!config.alwaysKeepZoomedIn) {
      setCursorTracking(null);
      return;
    }
    announceMediaTaskCreated(recordingId);
    void startTask({
      recordingId,
      kind: 'cursor_analysis',
      resourceClass: 'local_heavy',
      configSnapshot: { durationMs: metadata.durationMs },
    }, async (report, signal) => loadFullRecording(recordingId)
      .then(async (recording) => {
        if (cancelled || !recording.screenBlob) return;
        setCursorTracking({ progress: 0 });
        const track = await analyzeCursorFocusTrack({
          recordingId,
          screenBlob: recording.screenBlob,
          durationMs: metadata.durationMs,
          signal,
          onProgress: (progress) => {
            report({ phase: 'analyzing_cursor', ratio: progress });
            if (!cancelled) setCursorTracking((current) => ({ ...current, progress }));
          },
        });
        if (cancelled) return;
        setCursorTracking({ progress: 1, quality: track.quality });
        setFocusTrackRevision((revision) => revision + 1);
        return { resultRef: `cursor-focus:${recordingId}` };
      })
      .catch((error) => {
        if (!cancelled) setCursorTracking({ progress: 1, failed: true });
        throw error;
      })).catch(() => undefined);
    return () => { cancelled = true; };
  }, [config.alwaysKeepZoomedIn, metadata.durationMs, recordingId, startTask]);

  useEffect(() => {
    let cancelled = false;
    let createdAudioUrl: string | null = null;
    let createdCameraUrl: string | null = null;
    if (!config.localizedTrackId) {
      setLocalizedTrack(null);
      setLocalizedAudioUrl(null);
      setLocalizedCameraUrl(null);
      return;
    }
    getLocalizedTrack(config.localizedTrackId)
      .then((track) => {
        if (cancelled) return;
        if (!isUsableLocalizedTrack(track)) {
          setLocalizedTrack(null);
          setLocalizedAudioUrl(null);
          setLocalizedCameraUrl(null);
          return;
        }
        createdAudioUrl = URL.createObjectURL(track.audioBlob);
        createdCameraUrl = track.cameraBlob ? URL.createObjectURL(track.cameraBlob) : null;
        setLocalizedTrack(track);
        setLocalizedAudioUrl(createdAudioUrl);
        setLocalizedCameraUrl(createdCameraUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setLocalizedTrack(null);
          setLocalizedAudioUrl(null);
          setLocalizedCameraUrl(null);
        }
      });
    return () => {
      cancelled = true;
      if (createdAudioUrl) URL.revokeObjectURL(createdAudioUrl);
      if (createdCameraUrl) URL.revokeObjectURL(createdCameraUrl);
    };
  }, [config.localizedTrackId]);

  useEffect(() => {
    let cancelled = false;
    let createdAudioUrl: string | null = null;
    if (!config.activeEnhancedAudioTrackId || !sourceAudioFingerprint || (localizedTrack && config.muteOriginalAudio !== false)) {
      setEnhancedAudioTrack(null);
      setEnhancedAudioUrl(null);
      return;
    }
    void getEnhancedAudioTrack(config.activeEnhancedAudioTrackId)
      .then((track) => {
        if (cancelled) return;
        if (!track || track.status !== 'ready' || track.audioBlob.size === 0 || track.sourceFingerprint !== sourceAudioFingerprint) {
          setEnhancedAudioTrack(null);
          setEnhancedAudioUrl(null);
          return;
        }
        createdAudioUrl = URL.createObjectURL(track.audioBlob);
        setEnhancedAudioTrack(track);
        setEnhancedAudioUrl(createdAudioUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setEnhancedAudioTrack(null);
          setEnhancedAudioUrl(null);
        }
      });
    return () => {
      cancelled = true;
      if (createdAudioUrl) URL.revokeObjectURL(createdAudioUrl);
    };
  }, [config.activeEnhancedAudioTrackId, config.muteOriginalAudio, localizedTrack, sourceAudioFingerprint]);

  // 当前 timeMs 对应的摄像头位置（百分比）。
  // shell on 时，气泡定位用 letterboxed shell 区作为坐标系（跟导出 pipeline 一致）；
  // shell off / 无 shell 时，整张预览框作为坐标系。
  const cameraOverlayStyle = useMemo<React.CSSProperties>(() => {
    const preset = resolveExportOutputSize(config);
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

    // 视频背景启用时，摄像头仍属于固定的前景录制窗口，不能漂在背景上。
    const recordingWindow = getRecordingWindowRect(preset.width, preset.height, config.videoBackground);
    if (recordingWindow) {
      bounds = {
        offFracX: (recordingWindow.x + bounds.offFracX * preset.width * recordingWindow.scale) / preset.width,
        offFracY: (recordingWindow.y + bounds.offFracY * preset.height * recordingWindow.scale) / preset.height,
        fracW: bounds.fracW * recordingWindow.scale,
        fracH: bounds.fracH * recordingWindow.scale,
      };
    }

    // 尺寸按 camBounds「较短边」归一（与导出 pipeline 同口径，跨比例协调）。
    // 气泡为正方形：width 是占框宽的比例；按较短边换算成占宽比例 = rs × min(fracW, fracH/aspect)。
    const aspect = preset.width / preset.height; // = boxW/boxH
    const pos = cameraPositionAt(cameraEvents, timeMs);
    if (pos) {
      const projected = projectCameraPlacement(cameraPlacementFromEvent(pos), {
        x: bounds.offFracX * preset.width,
        y: bounds.offFracY * preset.height,
        width: bounds.fracW * preset.width,
        height: bounds.fracH * preset.height,
      });
      return {
        left: `${(projected.x / preset.width) * 100}%`,
        top: `${(projected.y / preset.height) * 100}%`,
        width: `${(projected.size / preset.width) * 100}%`,
        // hidden=true（录制时用户软关闭过摄像头）期间不画气泡 —— 跟导出 MP4 一致
        display: pos.hidden ? 'none' : undefined,
      };
    }
    // legacy fallback：右下角，按较短边 ~22%
    const wFrac = Math.min(bounds.fracW, bounds.fracH / aspect) * 0.22;
    const hFrac = wFrac * aspect;
    return {
      left: `${(bounds.offFracX + bounds.fracW - wFrac - bounds.fracW * 0.025) * 100}%`,
      top: `${(bounds.offFracY + bounds.fracH - hFrac - bounds.fracH * 0.04) * 100}%`,
      width: `${wFrac * 100}%`,
    };
  }, [cameraEvents, timeMs, firstShell, config.aspectRatio, config.includeWorkspaceShell, config.videoBackground]);

  // 帧渲染：节流到 CANVAS_REDRAW_INTERVAL_MS。静态 scrub 时立即重绘。
  const drawFrame = useCallback((t: number, force: boolean) => {
    if (!canvasRef.current) return;
    const now = performance.now();
    const redrawInterval = metadata.source?.kind && metadata.source.kind !== 'whiteboard'
      ? DISPLAY_REDRAW_INTERVAL_MS
      : WHITEBOARD_REDRAW_INTERVAL_MS;
    if (!force && now - lastDrawAtRef.current < redrawInterval) return;
    if (!force && Math.abs(t - lastDrawTimeMsRef.current) < redrawInterval / 2) return;
    lastDrawAtRef.current = now;
    lastDrawTimeMsRef.current = t;
    void renderRunnerRef.current?.push(t);
  }, [recordingId, config, focusTrackRevision]);

  // config 切换 或 暂停态下播放头被外部（时间轴）拖动 → 重绘该源帧。
  // 播放中由播放循环负责重绘，这里跳过避免双重绘制。
  useEffect(() => {
    if (!playing) drawFrame(timeMs, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, config, metadata.subtitleSrt, timeMs, playing]);

  // 播放循环：performance.now() 主时钟 + 节流 canvas 重绘
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clockRef.current = null;
      return;
    }
    // baseTime = 起播时刻的「成片输出时间」；循环走输出时间，映射回源时间渲染。
    clockRef.current = { perfStart: performance.now(), baseTime: sourceToOutput(kept, timeMs) };
    const audio = audioRef.current;
    const camera = cameraRef.current;
    const tick = () => {
      const ref = clockRef.current;
      if (!ref) return;
      const outT = ref.baseTime + (performance.now() - ref.perfStart);
      if (keptDur > 0 && outT >= keptDur) {
        const endSrc = outputToSource(kept, keptDur);
        setTimeMs(endSrc);
        drawFrame(endSrc, true);
        setPlaying(false);
        if (audio) { try { audio.pause(); } catch { /* ignore */ } }
        if (camera) { try { camera.pause(); } catch { /* ignore */ } }
        return;
      }
      const src = outputToSource(kept, outT);
      setTimeMs(src);
      drawFrame(src, false);
      const sSec = src / 1000;
      // 段内自然播放；跨被删段（src 跳变）漂移 > 0.3s 时强制 seek 对齐。
      if (audio && isFinite(audio.currentTime) && Math.abs(audio.currentTime - sSec) > 0.3) {
        try { audio.currentTime = sSec; } catch { /* ignore */ }
      }
      if (camera && isFinite(camera.currentTime) && Math.abs(camera.currentTime - sSec) > 0.3) {
        try { camera.currentTime = sSec; } catch { /* ignore */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, drawFrame, kept, keptDur]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      const camera = cameraRef.current;
      if (next) {
        const curOut = sourceToOutput(kept, timeMs);
        const restart = keptDur > 0 && curOut >= keptDur - 50;
        const startSrc = restart ? outputToSource(kept, 0) : timeMs;
        if (restart) {
          setTimeMs(startSrc);
          drawFrame(startSrc, true);
        }
        if (audio) {
          try { audio.currentTime = startSrc / 1000; } catch { /* ignore */ }
          void audio.play().catch(() => { /* ignore */ });
        }
        if (camera) {
          try { camera.currentTime = startSrc / 1000; } catch { /* ignore */ }
          void camera.play().catch(() => { /* ignore */ });
        }
      } else {
        if (audio) audio.pause();
        if (camera) camera.pause();
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, keptDur, timeMs, drawFrame]);

  // 预览进度条：可拖刮擦（成片输出时间 → 源时间），与底部时间轴等效
  const barRef = useRef<HTMLDivElement>(null);
  const scrubBarToClientX = useCallback((clientX: number): number | null => {
    const el = barRef.current;
    if (!el || keptDur <= 0) return null;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const src = outputToSource(kept, ratio * keptDur);
    setTimeMs(src);
    return src;
  }, [kept, keptDur, setTimeMs]);
  const startBarScrub = useCallback((e: React.MouseEvent) => {
    if (keptDur <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const wasPlaying = playing;
    if (!wasPlaying) {
      if (audioRef.current) audioRef.current.pause();
      if (cameraRef.current) cameraRef.current.pause();
    }
    const syncMedia = (src: number) => {
      const sec = src / 1000;
      if (audioRef.current) {
        try { audioRef.current.currentTime = sec; } catch { /* ignore */ }
      }
      if (cameraRef.current) {
        try { cameraRef.current.currentTime = sec; } catch { /* ignore */ }
      }
      if (wasPlaying) {
        clockRef.current = { perfStart: performance.now(), baseTime: sourceToOutput(kept, src) };
      }
    };
    const initial = scrubBarToClientX(e.clientX);
    if (initial !== null) syncMedia(initial);
    const move = (ev: MouseEvent) => {
      const src = scrubBarToClientX(ev.clientX);
      if (src !== null) syncMedia(src);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (wasPlaying) {
        void audioRef.current?.play().catch(() => { /* ignore */ });
        void cameraRef.current?.play().catch(() => { /* ignore */ });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [kept, keptDur, playing, scrubBarToClientX]);

  // scrub 由时间轴驱动（onPlayheadChange → playheadMs）；预览不再自带进度条。
  const preset = resolveExportOutputSize(config);
  const aspect = preset.width / preset.height;
  const responsiveInitialMaxHeight = useMemo(() => {
    if (!editorViewportHeight) return 560;
    return Math.round(clamp(editorViewportHeight - 316, PREVIEW_MIN_HEIGHT, 544));
  }, [editorViewportHeight]);

  const initialPreviewHeight = useMemo(() => {
    const maxW = Math.max(1, Math.floor((parentWidth || PREVIEW_PREFERRED_WIDTH) - 16));
    const minW = Math.min(PREVIEW_MIN_WIDTH, maxW, responsiveInitialMaxHeight * aspect);
    const preferred = Math.min(maxW, Math.max(minW, Math.min(PREVIEW_PREFERRED_WIDTH, maxW * 0.78)));
    return Math.round(clamp(preferred / aspect, PREVIEW_MIN_HEIGHT, responsiveInitialMaxHeight));
  }, [aspect, parentWidth, responsiveInitialMaxHeight]);

  useEffect(() => {
    if (requestedHeight === null && parentWidth > 0) {
      setRequestedHeight(initialPreviewHeight);
    }
  }, [initialPreviewHeight, parentWidth, requestedHeight]);

  const previewBox = useMemo(() => {
    const h = Math.round(clamp(requestedHeight ?? initialPreviewHeight, PREVIEW_MIN_HEIGHT, PREVIEW_MAX_HEIGHT));
    return {
      w: Math.round(h * aspect),
      h,
    };
  }, [aspect, initialPreviewHeight, requestedHeight]);

  const resizePreview = useCallback((nextHeight: number) => {
    setRequestedHeight(Math.round(clamp(nextHeight, PREVIEW_MIN_HEIGHT, PREVIEW_MAX_HEIGHT)));
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = previewBox.h;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => resizePreview(startHeight + moveEvent.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [previewBox.h, resizePreview]);

  const controlScale = Math.max(0.78, Math.min(1.35, previewBox.w / 720));

  // 摄像头气泡位置/尺寸由 cameraOverlayStyle 计算（events → 动态；无事件 → 右下角 18% 宽度）
  const cameraShape = metadata.setup?.camera.shape ?? 'circle';
  const previewAutoZoomScale = autoZoomAt(config.autoZooms, timeMs)?.scale ?? 1;
  const activeAudioUrl = localizedTrack && config.muteOriginalAudio !== false
    ? localizedAudioUrl
    : (enhancedAudioUrl ?? audioUrl);
  const activeCameraUrl = localizedCameraUrl ?? cameraUrl;
  const selectedAutoZoom = useMemo(
    () => config.autoZooms?.find((zoom) => zoom.id === selectedAutoZoomId) ?? null,
    [config.autoZooms, selectedAutoZoomId],
  );
  const selectedHighlight = useMemo(
    () => config.highlights?.find((item) => item.id === selectedHighlightId) ?? null,
    [config.highlights, selectedHighlightId],
  );

  // 与 exportPipeline 的 zoomBounds / drawRecordingWindow 一致：框选目标永远位于实际
  // 会被放大的内容区域中；workspace shell 与视频背景的边框、留白都不会被框进去。
  const zoomContentBounds = useMemo(() => {
    const preset = resolveExportOutputSize(config);
    let bounds = { x: 0, y: 0, width: 1, height: 1 };
    const useShell = !!firstShell && (config.includeWorkspaceShell ?? true);
    if (useShell && firstShell) {
      const scale = Math.min(preset.width / firstShell.shellSize.width, preset.height / firstShell.shellSize.height);
      const shellW = firstShell.shellSize.width * scale;
      const shellH = firstShell.shellSize.height * scale;
      bounds = {
        x: ((preset.width - shellW) / 2 + firstShell.canvasRect.x * scale) / preset.width,
        y: ((preset.height - shellH) / 2 + firstShell.canvasRect.y * scale) / preset.height,
        width: firstShell.canvasRect.width * scale / preset.width,
        height: firstShell.canvasRect.height * scale / preset.height,
      };
    }
    const recordingWindow = getRecordingWindowRect(preset.width, preset.height, config.videoBackground);
    if (!recordingWindow) return bounds;
    return {
      x: (recordingWindow.x + bounds.x * preset.width * recordingWindow.scale) / preset.width,
      y: (recordingWindow.y + bounds.y * preset.height * recordingWindow.scale) / preset.height,
      width: bounds.width * recordingWindow.scale,
      height: bounds.height * recordingWindow.scale,
    };
  }, [config.aspectRatio, config.includeWorkspaceShell, config.videoBackground, firstShell]);

  const zoomRegionStyle = useMemo<React.CSSProperties | null>(() => {
    if (!selectedAutoZoom) return null;
    const scale = clamp(selectedAutoZoom.scale, 1.05, 4);
    const width = zoomContentBounds.width / scale;
    const height = zoomContentBounds.height / scale;
    const cx = zoomContentBounds.x + clamp(selectedAutoZoom.cx ?? 0.5, 0, 1) * zoomContentBounds.width;
    const cy = zoomContentBounds.y + clamp(selectedAutoZoom.cy ?? 0.5, 0, 1) * zoomContentBounds.height;
    return {
      left: `${clamp(cx - width / 2, zoomContentBounds.x, zoomContentBounds.x + zoomContentBounds.width - width) * 100}%`,
      top: `${clamp(cy - height / 2, zoomContentBounds.y, zoomContentBounds.y + zoomContentBounds.height - height) * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
    };
  }, [selectedAutoZoom, zoomContentBounds]);

  const startZoomRegionDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedAutoZoom || !onAutoZoomRegionChange || !zoomRegionStyle) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = event.currentTarget.closest('[data-testid="export-preview-stage"]');
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const content = {
      x: zoomContentBounds.x * stageRect.width,
      y: zoomContentBounds.y * stageRect.height,
      width: zoomContentBounds.width * stageRect.width,
      height: zoomContentBounds.height * stageRect.height,
    };
    const initialScale = clamp(selectedAutoZoom.scale, 1.05, 4);
    const initialWidth = content.width / initialScale;
    const initialHeight = content.height / initialScale;
    const initialCx = content.x + clamp(selectedAutoZoom.cx ?? 0.5, 0, 1) * content.width;
    const initialCy = content.y + clamp(selectedAutoZoom.cy ?? 0.5, 0, 1) * content.height;
    const initialLeft = clamp(initialCx - initialWidth / 2, content.x, content.x + content.width - initialWidth);
    const initialTop = clamp(initialCy - initialHeight / 2, content.y, content.y + content.height - initialHeight);
    const resizing = (event.target as HTMLElement).closest('[data-autozoom-region-resize]') !== null;
    const onMove = (move: PointerEvent) => {
      const localX = move.clientX - stageRect.left;
      const localY = move.clientY - stageRect.top;
      if (resizing) {
        // 保持输出画幅的宽高比：选择框即最终导出要放大的 source crop。
        const width = clamp(localX - initialLeft, content.width / 4, content.width / 1.05);
        const scale = clamp(content.width / width, 1.05, 4);
        const finalWidth = content.width / scale;
        const finalHeight = content.height / scale;
        const left = clamp(initialLeft, content.x, content.x + content.width - finalWidth);
        const top = clamp(initialTop, content.y, content.y + content.height - finalHeight);
        onAutoZoomRegionChange(selectedAutoZoom.id, {
          scale,
          cx: clamp((left + finalWidth / 2 - content.x) / content.width, 0, 1),
          cy: clamp((top + finalHeight / 2 - content.y) / content.height, 0, 1),
        });
        return;
      }
      const cx = clamp(localX, content.x + initialWidth / 2, content.x + content.width - initialWidth / 2);
      const cy = clamp(localY, content.y + initialHeight / 2, content.y + content.height - initialHeight / 2);
      onAutoZoomRegionChange(selectedAutoZoom.id, {
        cx: (cx - content.x) / content.width,
        cy: (cy - content.y) / content.height,
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, [onAutoZoomRegionChange, selectedAutoZoom, zoomContentBounds, zoomRegionStyle]);

  const highlightRegionStyle = useMemo<React.CSSProperties | null>(() => {
    if (!selectedHighlight) return null;
    return {
      left: `${(zoomContentBounds.x + selectedHighlight.region.x * zoomContentBounds.width) * 100}%`,
      top: `${(zoomContentBounds.y + selectedHighlight.region.y * zoomContentBounds.height) * 100}%`,
      width: `${selectedHighlight.region.width * zoomContentBounds.width * 100}%`,
      height: `${selectedHighlight.region.height * zoomContentBounds.height * 100}%`,
    };
  }, [selectedHighlight, zoomContentBounds]);

  const startHighlightRegionDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedHighlight || !onHighlightRegionChange) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = event.currentTarget.closest('[data-testid="export-preview-stage"]');
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const content = {
      x: zoomContentBounds.x * stageRect.width,
      y: zoomContentBounds.y * stageRect.height,
      width: zoomContentBounds.width * stageRect.width,
      height: zoomContentBounds.height * stageRect.height,
    };
    const originX = event.clientX;
    const originY = event.clientY;
    const initial = { ...selectedHighlight.region };
    const resizing = (event.target as HTMLElement).closest('[data-highlight-region-resize]') !== null;
    const onMove = (move: PointerEvent) => {
      const dx = (move.clientX - originX) / content.width;
      const dy = (move.clientY - originY) / content.height;
      if (resizing) {
        onHighlightRegionChange(selectedHighlight.id, {
          ...initial,
          width: clamp(initial.width + dx, 0.02, 1 - initial.x),
          height: clamp(initial.height + dy, 0.02, 1 - initial.y),
        });
        return;
      }
      onHighlightRegionChange(selectedHighlight.id, {
        ...initial,
        x: clamp(initial.x + dx, 0, 1 - initial.width),
        y: clamp(initial.y + dy, 0, 1 - initial.height),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, [onHighlightRegionChange, selectedHighlight, zoomContentBounds]);

  return (
    <div className="export-preview-craft-wrap w-full">
      <div
        ref={parentRef}
        data-testid="export-preview-workspace"
        className="flex w-full items-center overflow-x-auto overflow-y-hidden p-2"
        style={{ height: previewBox.h + 16 }}
      >
      <div
        data-testid="export-preview-stage"
        data-autozoom-scale={previewAutoZoomScale.toFixed(3)}
        data-has-subtitles={metadata.subtitleSrt ? 'true' : 'false'}
        data-localized-track={localizedTrack?.id}
        data-autozoom-region={selectedAutoZoom ? `${(selectedAutoZoom.cx ?? 0.5).toFixed(3)},${(selectedAutoZoom.cy ?? 0.5).toFixed(3)},${selectedAutoZoom.scale.toFixed(3)}` : undefined}
        data-selection-overlays-hidden={selectionOverlaysHidden ? 'true' : 'false'}
        className="export-preview-craft-stage relative mx-auto overflow-hidden"
        style={{
          width: previewBox.w,
          height: previewBox.h,
          flex: '0 0 auto',
          '--preview-stage-background': previewStageBackground,
          border: '1.5px solid var(--ink)',
          borderRadius: 3,
        } as React.CSSProperties}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
        />

        {(selectedAutoZoom || selectedHighlight) && (
          <button
            type="button"
            data-testid="toggle-preview-selection-overlays"
            aria-pressed={selectionOverlaysHidden}
            onClick={() => setSelectionOverlaysHidden((value) => !value)}
            style={{
              position: 'absolute',
              right: 10,
              top: 46,
              zIndex: 42,
              height: 30,
              padding: '0 11px',
              border: '1px solid rgba(34,34,34,.18)',
              borderRadius: 999,
              background: 'rgba(255,253,248,.88)',
              color: 'var(--ink)',
              boxShadow: '0 8px 20px rgba(22,24,26,.12), inset 0 1px 0 rgba(255,255,255,.76)',
              backdropFilter: 'blur(14px) saturate(1.04)',
              WebkitBackdropFilter: 'blur(14px) saturate(1.04)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            {selectionOverlaysHidden ? t('showSelectionOverlays') : t('hideSelectionOverlays')}
          </button>
        )}

        {zoomRegionStyle && selectedAutoZoom && !selectionOverlaysHidden && (
          <div
            data-testid="autozoom-region"
            aria-label="Autozoom target region"
            title="Drag to move the Auto Zoom target; drag the corner to resize"
            onPointerDown={startZoomRegionDrag}
            style={{
              ...zoomRegionStyle,
              position: 'absolute',
              zIndex: 25,
              border: '2px solid rgba(116, 78, 184, .95)',
              borderRadius: 8,
              background: 'rgba(158, 125, 235, .10)',
              boxShadow: '0 0 0 999px rgba(17, 20, 23, .12), 0 0 0 1px rgba(255,255,255,.76) inset',
              cursor: 'move',
              touchAction: 'none',
            }}
          >
            <span
              data-autozoom-region-resize
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: -7,
                bottom: -7,
                width: 13,
                height: 13,
                borderRadius: 999,
                border: '2px solid #fffdf8',
                background: 'rgb(116, 78, 184)',
                boxShadow: '0 2px 7px rgba(49,31,83,.35)',
                cursor: 'nwse-resize',
              }}
            />
          </div>
        )}

        {highlightRegionStyle && selectedHighlight && !selectionOverlaysHidden && (
          <div
            data-testid="highlight-region"
            aria-label="Highlight region"
            title="Drag to move; drag the corner to freely resize width and height"
            onPointerDown={startHighlightRegionDrag}
            style={{
              ...highlightRegionStyle,
              position: 'absolute',
              zIndex: 26,
              border: '2px solid rgba(255, 176, 28, .98)',
              borderRadius: 4,
              background: 'rgba(255, 190, 48, .08)',
              boxShadow: '0 0 0 1px rgba(255,255,255,.8) inset',
              cursor: 'move',
              touchAction: 'none',
            }}
          >
            <span
              data-highlight-region-resize
              aria-hidden="true"
              style={{
                position: 'absolute', right: -7, bottom: -7, width: 13, height: 13,
                borderRadius: 3, border: '2px solid #fffdf8', background: '#ffb01c',
                boxShadow: '0 2px 7px rgba(65,46,12,.3)', cursor: 'nwse-resize',
              }}
            />
          </div>
        )}

        {/* 摄像头气泡：位置/尺寸跟随 cameraEvents（无事件时回退右下角） */}
        {activeCameraUrl && (
          <div
            data-testid="export-preview-camera"
            data-camera-shape={cameraShape}
            className="pointer-events-none absolute z-30 overflow-hidden transition-[left,top,width] duration-100"
            style={{
              ...cameraOverlayStyle,
              aspectRatio: '1 / 1',
              borderRadius: cameraShape === 'circle' ? '50%' : '14%',
              background: '#1f2937',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,255,255,0.9)',
            }}
          >
            <video
              ref={cameraRef}
              src={activeCameraUrl}
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
        {activeAudioUrl && (
          <audio
            data-testid="export-preview-audio"
            data-localized-audio={localizedTrack && config.muteOriginalAudio !== false ? 'true' : 'false'}
            data-enhanced-audio={enhancedAudioTrack ? enhancedAudioTrack.mode : 'false'}
            ref={audioRef}
            src={activeAudioUrl}
            preload="auto"
            hidden
          />
        )}

        <div
          className="export-preview-craft-badge absolute left-3 top-3 flex items-center gap-1.5"
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

        {rendering && !playing && (
          <span
            className="export-preview-craft-rendering fade-in absolute right-3 top-3"
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
            className="export-preview-craft-error fade-in absolute inset-x-3 top-12"
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

        {(
          <div
            className="export-preview-craft-controls absolute inset-x-4 bottom-3 flex items-center gap-3"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              padding: `${6 * controlScale}px ${10 * controlScale}px ${6 * controlScale}px ${6 * controlScale}px`,
              borderRadius: 3,
              border: '1.3px solid var(--ink)',
              // 自身 overflow-hidden 防 input 极窄时 second-order 溢出把右 span 推出
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              data-testid="export-preview-play-toggle"
              onClick={togglePlay}
              disabled={metadata.durationMs === 0}
              className="grid place-items-center"
              style={{
                width: 26 * controlScale,
                height: 26 * controlScale,
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
                fontSize: 11 * controlScale,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {(sourceToOutput(kept, timeMs) / 1000).toFixed(1)}s
            </span>
            {/* 成片输出进度：可拖刮擦 —— 外层高 16px 做抓取热区、内层细条仅视觉；minWidth:0 保证 9:16 窄盒能缩 */}
            <div
              data-testid="export-preview-progress-scrubber"
              ref={barRef}
              onMouseDown={startBarScrub}
              className="flex flex-1 items-center"
              style={{ minWidth: 0, height: 16 * controlScale, cursor: keptDur > 0 ? 'ew-resize' : 'default' }}
            >
              <div className="w-full" style={{ height: 4 * controlScale, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden', pointerEvents: 'none' }}>
                <div style={{ height: '100%', width: `${keptDur > 0 ? Math.min(100, (sourceToOutput(kept, timeMs) / keptDur) * 100) : 0}%`, background: 'var(--hi)' }} />
              </div>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11 * controlScale,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {(keptDur / 1000).toFixed(1)}s
            </span>
          </div>
        )}

        {(
          <div
            className="absolute right-3 top-3 z-40 flex items-center gap-1"
            style={{ background: 'rgba(255,253,248,.9)', border: '1px solid rgba(31,34,37,.12)', borderRadius: 999, padding: 3, backdropFilter: 'blur(10px)' }}
          >
            <button type="button" aria-label="Shrink preview" onClick={() => resizePreview(previewBox.h - 68)} style={resizeButtonStyle}>−</button>
            <span style={{ padding: '0 5px', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{Math.round(previewBox.h)}px</span>
            <button data-testid="preview-enlarge" type="button" aria-label="Enlarge preview" onClick={() => resizePreview(previewBox.h + 68)} style={resizeButtonStyle}>+</button>
          </div>
        )}

        {(
          <button
            data-testid="preview-resize-handle"
            type="button"
            aria-label="Resize preview window"
            onPointerDown={startResize}
            className="absolute bottom-2 right-2 z-40 grid place-items-center"
            style={{ width: 24, height: 24, border: 'none', borderRadius: 999, background: 'rgba(255,253,248,.84)', color: 'var(--ink-2)', cursor: 'nwse-resize', boxShadow: '0 4px 10px rgba(24,25,26,.1)' }}
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1, transform: 'rotate(-45deg)' }}>↔</span>
          </button>
        )}

      </div>
      </div>
    </div>
  );
}
