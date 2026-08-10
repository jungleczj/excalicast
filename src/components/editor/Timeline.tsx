'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { I } from '@/components/icons';
import { AutoEditControl } from '@/components/editor/AutoEditControl';
import type { AutoEditMode, AutoEditProgress, AutoEditResult } from '@/services/autoEditAnalyzer';
import type {
  AutoZoomSegment,
  HighlightEffectSegment,
  KeyPointMotionSegment,
  NoiseReductionMode,
  SubtitleCue,
  TimeSegment,
} from '@/types/recording';
import { keptDuration, splitSegments, removeSegmentAt, trimSegmentEdge } from '@/utils/segments';

interface Props {
  durationMs: number;
  /** 保留片段（=clips，源 ms）。被删 = 其在 [0,dur] 的补集。 */
  clips: TimeSegment[];
  /** 播放头源时间（ms）。 */
  playheadMs: number;
  /** 拖播放头 / 拖片段边缘 / 点轨道 → 实时把预览 scrub 到该源时间。 */
  onScrub: (srcMs: number) => void;
  /** split / 删除片段 / trim 边缘后的新 clips。 */
  onChange: (clips: TimeSegment[]) => void;
  /** 复原为整段。 */
  onReset: () => void;
  /** Screen Studio 风格的独立 zoom 轨道。 */
  autoZooms?: AutoZoomSegment[];
  onAutoZoomChange?: (next: AutoZoomSegment[]) => void;
  selectedAutoZoomId?: string | null;
  onAutoZoomSelect?: (id: string | null) => void;
  highlights?: HighlightEffectSegment[];
  onHighlightChange?: (next: HighlightEffectSegment[]) => void;
  selectedHighlightId?: string | null;
  onHighlightSelect?: (id: string | null) => void;
  keyPointMotions?: KeyPointMotionSegment[];
  onKeyPointMotionChange?: (next: KeyPointMotionSegment[]) => void;
  selectedKeyPointMotionId?: string | null;
  onKeyPointMotionSelect?: (id: string | null) => void;
  onGenerateKeyPointMotions?: () => void;
  keyPointGenerationPhase?: 'idle' | 'generating' | 'ready' | 'failed';
  audioEnhancement?: {
    phase: 'idle' | 'processing' | 'ready' | 'failed';
    mode: NoiseReductionMode | 'original';
    progress: number;
    error?: string | null;
    onRun: (mode: NoiseReductionMode) => void;
    onOriginal: () => void;
    onCancel: () => void;
  };
  /** 本地静音分析；结果仍写入既有的 clips/segments，而非重编码原始媒体。 */
  autoEdit?: {
    phase: 'idle' | 'analyzing' | 'applied' | 'failed';
    result: AutoEditResult | null;
    error: string | null;
    progress: AutoEditProgress | null;
    onRun: (preset: AutoEditMode) => void;
    onUndo: () => void;
    onCancel: () => void;
    labels: {
      autoEdit: string; chatCut: string; lecture: string; walkthrough: string; shorts: string; timing: string;
      gentle: string; standard: string; tight: string; analyzing: string; noAudio: string;
      removed: (cuts: number, seconds: string) => string; noCuts: string; sceneAware: (transitions: number, alignedCuts: number) => string; undo: string;
    };
  };
  hasAudio: boolean;
  hasCaptions: boolean;
  audioPeaks?: number[];
  captionCues?: SubtitleCue[];
  labels: {
    edit: string; reset: string; kept: string; mic: string; captions: string;
    split: string; deleteClip: string; hint: string;
    autoZoom: string; autoZoomHint: string; editAutoZoomScale: string;
    highlight: string; noiseReduction: string; standardNoiseReduction: string;
    enhancedNoiseReduction: string; originalAudio: string;
    keyPointMotion: string; keyPointNeedsCaptions: string; generating: string;
    spotlight: string; focusFrame: string; cursorHalo: string; textCallout: string;
    calloutText: string; opacity: string;
  };
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const TIMELINE_ZOOM_STEPS = [1, 2, 4, 8, 16, 32] as const;

/**
 * 时间轴（主流剪辑交互，对标 Clipchamp / NLE）：
 * - 拖播放头 / 拖片段边缘 / 点轨道 → 实时预览对应帧。
 * - Split（✂，在播放头处把片段切两段）+ 选中片段 → 删除（剪掉任意中间段）。
 * - 片段两端 Trim 手柄裁头尾。
 * 数据＝保留片段 `clips`（gap＝被删）；导出按保留段拼接输出（见 exportPipeline）。
 */
export function Timeline({
  durationMs, clips, playheadMs, onScrub, onChange, onReset,
  autoZooms = [], onAutoZoomChange, selectedAutoZoomId, onAutoZoomSelect,
  highlights = [], onHighlightChange, selectedHighlightId, onHighlightSelect,
  keyPointMotions = [], onKeyPointMotionChange, selectedKeyPointMotionId, onKeyPointMotionSelect,
  onGenerateKeyPointMotions, keyPointGenerationPhase = 'idle', audioEnhancement,
  autoEdit,
  hasAudio, hasCaptions, audioPeaks = [], captionCues = [], labels,
}: Props): JSX.Element {
  const zoomLabels = useTranslations('timelineZoom');
  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef(false);
  const userScrollRef = useRef(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingZoomAnchorRef = useRef<{ timeMs: number; viewportX: number } | null>(null);
  const playheadMsRef = useRef(playheadMs);
  playheadMsRef.current = playheadMs;
  const dur = Math.max(1, durationMs);
  const trimmed = !(clips.length === 1 && clips[0].start <= 0 && clips[0].end >= durationMs);
  const kept = keptDuration(clips);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editingZoomId, setEditingZoomId] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [viewportWidth, setViewportWidth] = useState(1);
  const [viewportScrollLeft, setViewportScrollLeft] = useState(0);
  const contentWidth = Math.max(1, viewportWidth * timelineZoom);
  const px = useCallback((ms: number) => (Math.max(0, Math.min(dur, ms)) / dur) * contentWidth, [contentWidth, dur]);
  const visibleStartMs = Math.max(0, Math.min(dur, (viewportScrollLeft / contentWidth) * dur));
  const visibleEndMs = Math.max(visibleStartMs, Math.min(dur, ((viewportScrollLeft + viewportWidth) / contentWidth) * dur));

  // 被删段 = clips 在 [0,dur] 的补集
  const gaps: TimeSegment[] = (() => {
    const out: TimeSegment[] = [];
    let cursor = 0;
    for (const s of clips) {
      if (s.start > cursor) out.push({ start: cursor, end: s.start });
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < durationMs) out.push({ start: cursor, end: durationMs });
    return out;
  })();

  const srcAtClientX = (clientX: number): number => {
    const el = viewportRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const measuredWidth = Math.max(1, el.scrollWidth);
    const ratio = Math.max(0, Math.min(1, (clientX - r.left + el.scrollLeft) / measuredWidth));
    return Math.round(ratio * durationMs);
  };

  const finishPointerInteraction = () => {
    interactionRef.current = false;
  };

  // 在标尺/空白处按下：移动播放头并持续 scrub（拖动 = 刮擦预览）
  const startScrub = (e: React.MouseEvent) => {
    e.preventDefault();
    interactionRef.current = true;
    onScrub(srcAtClientX(e.clientX));
    const move = (ev: MouseEvent) => onScrub(srcAtClientX(ev.clientX));
    const up = () => {
      finishPointerInteraction();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 拖片段边缘 Trim：基于拖拽起点的 clips 重算（幂等、无漂移），并实时 scrub 到该边缘
  const startEdgeDrag = (i: number, side: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    interactionRef.current = true;
    setSelectedIdx(i);
    const base = clips.map((s) => ({ ...s }));
    const move = (ev: MouseEvent) => {
      const t = srcAtClientX(ev.clientX);
      onChange(trimSegmentEdge(base, i, side, t));
      onScrub(t);
    };
    const up = () => {
      finishPointerInteraction();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const doSplit = () => { onChange(splitSegments(clips, playheadMs)); setSelectedIdx(null); };
  const doDelete = () => {
    if (selectedIdx == null) return;
    onChange(removeSegmentAt(clips, selectedIdx));
    setSelectedIdx(null);
  };

  const replaceZoom = (id: string, patch: Partial<AutoZoomSegment>) => {
    if (!onAutoZoomChange) return;
    onAutoZoomChange(autoZooms.map((zoom) => {
      if (zoom.id !== id) return zoom;
      const start = Math.max(0, Math.min(durationMs - 100, Math.round(patch.start ?? zoom.start)));
      const end = Math.max(start + 100, Math.min(durationMs, Math.round(patch.end ?? zoom.end)));
      const scale = Math.max(1.05, Math.min(4, Number(patch.scale ?? zoom.scale)));
      return { ...zoom, ...patch, start, end, scale };
    }).sort((a, b) => a.start - b.start));
  };

  const updateZoomScale = (id: string, raw: string) => {
    const scale = Number(raw);
    if (!Number.isFinite(scale)) return;
    replaceZoom(id, { scale: Math.round(scale * 100) / 100 });
  };

  const addZoomAt = (timeMs: number) => {
    if (!onAutoZoomChange) return;
    const start = Math.max(0, Math.min(Math.max(0, durationMs - 800), Math.round(timeMs)));
    const id = `az-${Date.now().toString(36)}`;
    onAutoZoomChange([
      ...autoZooms,
      { id, start, end: Math.min(durationMs, start + 2200), scale: 1.6, cx: 0.5, cy: 0.5 },
    ].sort((a, b) => a.start - b.start));
    onAutoZoomSelect?.(id);
  };

  const addHighlightAt = (timeMs: number) => {
    if (!onHighlightChange) return;
    const start = Math.max(0, Math.min(Math.max(0, durationMs - 800), Math.round(timeMs)));
    const id = `hl-${Date.now().toString(36)}`;
    const next: HighlightEffectSegment = {
      id,
      start,
      end: Math.min(durationMs, start + 2200),
      region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      enabled: { spotlight: true, focusFrame: true, cursorHalo: false, textCallout: false },
      spotlightOpacity: 0.54,
      transition: { enterMs: 600, exitMs: 420, easing: 'easeInOutCubic', preset: 'surround' },
      schemaVersion: 1,
    };
    onHighlightChange([
      ...highlights,
      next,
    ].sort((a, b) => a.start - b.start));
    onHighlightSelect?.(id);
  };

  const replaceHighlight = (id: string, patch: Partial<HighlightEffectSegment>) => {
    if (!onHighlightChange) return;
    onHighlightChange(highlights.map((item) => {
      if (item.id !== id) return item;
      const start = Math.max(0, Math.min(durationMs - 100, Math.round(patch.start ?? item.start)));
      const end = Math.max(start + 100, Math.min(durationMs, Math.round(patch.end ?? item.end)));
      return { ...item, ...patch, start, end };
    }).sort((a, b) => a.start - b.start));
  };

  const replaceKeyPointMotion = (id: string, patch: Partial<KeyPointMotionSegment>) => {
    if (!onKeyPointMotionChange) return;
    onKeyPointMotionChange(keyPointMotions.map((item) => {
      if (item.id !== id) return item;
      const start = Math.max(0, Math.min(durationMs - 100, Math.round(patch.start ?? item.start)));
      const end = Math.max(start + 100, Math.min(durationMs, Math.round(patch.end ?? item.end)));
      return { ...item, ...patch, start, end };
    }).sort((a, b) => a.start - b.start));
  };

  const startEffectDrag = (
    item: { id: string; start: number; end: number },
    mode: 'move' | 'start' | 'end',
    replace: (id: string, patch: { start?: number; end?: number }) => void,
    select: (id: string) => void,
  ) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = true;
    select(item.id);
    const dragOrigin = srcAtClientX(event.clientX);
    const move = (moveEvent: MouseEvent) => {
      const delta = srcAtClientX(moveEvent.clientX) - dragOrigin;
      if (mode === 'start') replace(item.id, { start: Math.max(0, Math.min(item.end - 100, item.start + delta)) });
      else if (mode === 'end') replace(item.id, { end: Math.max(item.start + 100, Math.min(durationMs, item.end + delta)) });
      else {
        const length = item.end - item.start;
        const start = Math.max(0, Math.min(durationMs - length, item.start + delta));
        replace(item.id, { start, end: start + length });
      }
      onScrub(Math.max(0, Math.min(durationMs, item.start + delta)));
    };
    const up = () => {
      finishPointerInteraction();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startZoomDrag = (id: string, mode: 'move' | 'start' | 'end') => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = true;
    const base = autoZooms.find((zoom) => zoom.id === id);
    if (!base) return;
    onAutoZoomSelect?.(id);
    const dragOrigin = srcAtClientX(event.clientX);
    const move = (moveEvent: MouseEvent) => {
      const delta = srcAtClientX(moveEvent.clientX) - dragOrigin;
      if (mode === 'start') {
        replaceZoom(id, { start: Math.max(0, Math.min(base.end - 100, base.start + delta)) });
      } else if (mode === 'end') {
        replaceZoom(id, { end: Math.max(base.start + 100, Math.min(durationMs, base.end + delta)) });
      } else {
        const length = base.end - base.start;
        const start = Math.max(0, Math.min(durationMs - length, base.start + delta));
        replaceZoom(id, { start, end: start + length });
      }
      onScrub(Math.max(0, Math.min(durationMs, base.start + delta)));
    };
    const up = () => {
      finishPointerInteraction();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 快捷键：S=Split、Delete/Backspace=删选中段（输入框聚焦时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); doSplit(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedIdx != null) { e.preventDefault(); doDelete(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, playheadMs, selectedIdx]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportWidth(Math.max(1, viewport.clientWidth));
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = pendingZoomAnchorRef.current;
    if (!viewport || !anchor) return;
    const measuredWidth = Math.max(1, viewport.scrollWidth);
    const nextScrollLeft = (anchor.timeMs / dur) * measuredWidth - anchor.viewportX;
    userScrollRef.current = true;
    viewport.scrollLeft = Math.max(0, Math.min(contentWidth - viewport.clientWidth, nextScrollLeft));
    setViewportScrollLeft(viewport.scrollLeft);
    pendingZoomAnchorRef.current = null;
    if (zoomAnchorTimerRef.current) clearTimeout(zoomAnchorTimerRef.current);
    zoomAnchorTimerRef.current = setTimeout(() => {
      userScrollRef.current = false;
    }, 180);
  }, [contentWidth, dur]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    if (zoomAnchorTimerRef.current) clearTimeout(zoomAnchorTimerRef.current);
  }, []);

  const ensurePlayheadVisible = useCallback((timeMs = playheadMsRef.current) => {
    const viewport = viewportRef.current;
    if (!viewport || interactionRef.current || userScrollRef.current) return;
    const playheadX = px(timeMs);
    const left = viewport.scrollLeft;
    const right = left + viewport.clientWidth;
    const gutter = Math.min(28, viewport.clientWidth * 0.08);
    if (playheadX < left + gutter) {
      viewport.scrollLeft = Math.max(0, playheadX - gutter);
    } else if (playheadX > right - gutter) {
      viewport.scrollLeft = Math.min(contentWidth - viewport.clientWidth, playheadX - viewport.clientWidth + gutter);
    }
    setViewportScrollLeft(viewport.scrollLeft);
  }, [contentWidth, px]);

  useEffect(() => {
    ensurePlayheadVisible(playheadMs);
  }, [ensurePlayheadVisible, playheadMs]);

  const applyTimelineZoom = (nextZoom: number, timeMs: number, viewportX: number) => {
    const next = Math.max(1, Math.min(32, nextZoom));
    if (next === timelineZoom) return;
    pendingZoomAnchorRef.current = { timeMs, viewportX };
    setTimelineZoom(next);
  };

  const zoomFromPlayhead = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = TIMELINE_ZOOM_STEPS.indexOf(timelineZoom as (typeof TIMELINE_ZOOM_STEPS)[number]);
    const nextIndex = Math.max(0, Math.min(TIMELINE_ZOOM_STEPS.length - 1, index + direction));
    const currentX = px(playheadMs) - viewport.scrollLeft;
    const anchorX = currentX >= 0 && currentX <= viewport.clientWidth ? currentX : viewport.clientWidth / 2;
    applyTimelineZoom(TIMELINE_ZOOM_STEPS[nextIndex], playheadMs, anchorX);
  };

  const fitTimeline = () => {
    const viewport = viewportRef.current;
    pendingZoomAnchorRef.current = { timeMs: 0, viewportX: 0 };
    setTimelineZoom(1);
    if (viewport) {
      viewport.scrollLeft = 0;
      setViewportScrollLeft(0);
    }
  };

  const handleTimelineWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const anchorX = Math.max(0, Math.min(viewport.clientWidth, event.clientX - bounds.left));
    const anchorTime = srcAtClientX(event.clientX);
    const index = TIMELINE_ZOOM_STEPS.indexOf(timelineZoom as (typeof TIMELINE_ZOOM_STEPS)[number]);
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(TIMELINE_ZOOM_STEPS.length - 1, index + direction));
    applyTimelineZoom(TIMELINE_ZOOM_STEPS[nextIndex], anchorTime, anchorX);
  };

  const handleTimelineScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setViewportScrollLeft(viewport.scrollLeft);
    userScrollRef.current = true;
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      userScrollRef.current = false;
      ensurePlayheadVisible();
    }, 180);
  };

  const canDelete = selectedIdx != null && clips.length > 1;

  return (
    <div className="timeline-craft-panel">
      <div className="timeline-craft-toolbar mb-2">
        <div className="timeline-craft-toolbar-main">
          <span className="timeline-craft-label" style={{ marginRight: 4 }}>
            {labels.edit}
          </span>
          <button type="button" onClick={doSplit} className="timeline-craft-action btn-sketch" style={{ padding: '3px 9px' }} title={`${labels.split} (S)`}>
            <span style={{ fontSize: 11 }}>✂</span> {labels.split}
          </button>
          <button type="button" onClick={doDelete} disabled={!canDelete} className="timeline-craft-action timeline-craft-danger btn-sketch" style={{ padding: '3px 9px' }} title={`${labels.deleteClip} (Del)`}>
            <I.Trash size={11} /> {labels.deleteClip}
          </button>
          {onAutoZoomChange && (
            <button
              data-testid="autozoom-drag-source"
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/x-excalicast-autozoom', 'new');
                event.dataTransfer.setData('text/plain', 'autozoom');
              }}
              onClick={() => addZoomAt(playheadMs)}
              className="timeline-craft-action btn-sketch"
              style={{ padding: '3px 9px' }}
              title={labels.autoZoomHint}
            >
              <I.Search size={11} /> {labels.autoZoom}
            </button>
          )}
          {onHighlightChange && (
            <button
              data-testid="highlight-add"
              type="button"
              onClick={() => addHighlightAt(playheadMs)}
              className="timeline-craft-action btn-sketch"
              style={{ padding: '3px 9px' }}
              title={labels.highlight}
            >
              <I.Highlighter size={11} /> {labels.highlight}
            </button>
          )}
          {autoEdit && (
            <AutoEditControl
              hasAudio={hasAudio}
              phase={autoEdit.phase}
              result={autoEdit.result}
              error={autoEdit.error}
              progress={autoEdit.progress}
              onRun={autoEdit.onRun}
              onUndo={autoEdit.onUndo}
              onCancel={autoEdit.onCancel}
              labels={autoEdit.labels}
            />
          )}
          {audioEnhancement && (
            <details className="timeline-craft-action-menu">
              <summary
                data-testid="noise-reduction-menu"
                data-phase={audioEnhancement.phase}
                data-mode={audioEnhancement.mode}
                className="timeline-craft-action btn-sketch"
                title={labels.noiseReduction}
              >
                <I.Mic size={11} /> {audioEnhancement.phase === 'processing'
                  ? `${labels.noiseReduction} ${Math.round(audioEnhancement.progress * 100)}%`
                  : labels.noiseReduction}
              </summary>
              <div className="timeline-craft-action-popover">
                <button data-testid="noise-standard" type="button" aria-pressed={audioEnhancement.mode === 'standard'} onClick={() => audioEnhancement.onRun('standard')}>{labels.standardNoiseReduction}</button>
                <button data-testid="noise-enhanced" type="button" aria-pressed={audioEnhancement.mode === 'enhanced'} onClick={() => audioEnhancement.onRun('enhanced')}>{labels.enhancedNoiseReduction}</button>
                <button data-testid="noise-original" type="button" aria-pressed={audioEnhancement.mode === 'original'} onClick={audioEnhancement.onOriginal}>{labels.originalAudio}</button>
                {audioEnhancement.phase === 'processing' && <button data-testid="noise-cancel" type="button" onClick={audioEnhancement.onCancel}>Cancel</button>}
                {audioEnhancement.error && <span className="timeline-craft-action-error" role="alert">{audioEnhancement.error}</span>}
              </div>
            </details>
          )}
          {onGenerateKeyPointMotions && (
            <button
              data-testid="keypoint-generate"
              type="button"
              disabled={!hasCaptions || keyPointGenerationPhase === 'generating'}
              onClick={onGenerateKeyPointMotions}
              className="timeline-craft-action btn-sketch"
              style={{ padding: '3px 9px' }}
              title={!hasCaptions ? labels.keyPointNeedsCaptions : labels.keyPointMotion}
            >
              <I.Sparkles size={11} /> {keyPointGenerationPhase === 'generating' ? labels.generating : labels.keyPointMotion}
            </button>
          )}
          {trimmed && (
            <button type="button" onClick={() => { onReset(); setSelectedIdx(null); }} className="timeline-craft-action btn-sketch" style={{ padding: '3px 8px' }}>
              {labels.reset}
            </button>
          )}
        </div>
        <div className="timeline-craft-toolbar-end">
          <div className="timeline-craft-zoom-controls" role="group" aria-label={zoomLabels('group')}>
            <button
              type="button"
              className="timeline-craft-zoom-button"
              aria-label={zoomLabels('zoomOut')}
              title={zoomLabels('zoomOut')}
              disabled={timelineZoom === 1}
              onClick={() => zoomFromPlayhead(-1)}
            >
              <span aria-hidden="true">−</span>
            </button>
            <span data-testid="timeline-zoom-value" className="timeline-craft-zoom-value label-mono" aria-live="polite">
              {timelineZoom === 1 ? zoomLabels('fit') : `${timelineZoom}x`}
            </span>
            <button
              type="button"
              className="timeline-craft-zoom-button"
              aria-label={zoomLabels('zoomIn')}
              title={zoomLabels('zoomIn')}
              disabled={timelineZoom === 32}
              onClick={() => zoomFromPlayhead(1)}
            >
              <I.Plus size={13} />
            </button>
            <button
              type="button"
              className="timeline-craft-zoom-button"
              aria-label={zoomLabels('fitTimeline')}
              title={zoomLabels('fitTimeline')}
              disabled={timelineZoom === 1}
              onClick={fitTimeline}
            >
              <I.Ratio16x9 size={13} />
            </button>
          </div>
          <span className="timeline-craft-kept label-mono">{labels.kept} · {fmt(kept)} / {fmt(durationMs)}</span>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-testid="timeline-viewport"
        className="timeline-craft-lane timeline-craft-viewport"
        onWheel={handleTimelineWheel}
        onScroll={handleTimelineScroll}
        style={{ position: 'relative', userSelect: 'none' }}
      >
        <div
          data-testid="timeline-content"
          className="timeline-craft-content"
          style={{ position: 'relative', width: contentWidth, minWidth: '100%' }}
        >
        {/* 标尺：拖动刮擦预览 */}
        <div className="timeline-craft-ruler" onMouseDown={startScrub} style={{ height: 14, cursor: 'ew-resize' }} />

        {/* 片段轨：整轨可拖刮擦（空白/gap 处）；clips=block 可点选 + 边缘 Trim；gap 变暗 */}
        <div data-testid="timeline-video-track" className="timeline-craft-track" onMouseDown={startScrub} style={{ position: 'relative', height: 30, overflow: 'hidden', cursor: 'ew-resize' }}>
          {gaps.map((g, i) => (
            <div key={`g${i}`} className="timeline-craft-gap" style={{ position: 'absolute', top: 0, bottom: 0, left: px(g.start), width: px(g.end - g.start) }} />
          ))}
          {clips.map((c, i) => {
            const sel = selectedIdx === i;
            return (
              <div
                key={`c${i}`}
                className={`timeline-craft-clip${sel ? ' is-selected' : ''}`}
                onMouseDown={(e) => { e.stopPropagation(); setSelectedIdx(i); startScrub(e); }}
                style={{
                  position: 'absolute', top: 2, bottom: 2, left: px(c.start), width: px(c.end - c.start),
                  cursor: 'ew-resize', overflow: 'hidden',
                }}
              >
                {/* 左右 Trim 手柄 */}
                <div className="timeline-craft-edge" onMouseDown={startEdgeDrag(i, 'start')} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, cursor: 'ew-resize', opacity: sel ? 0.9 : 0.55 }} />
                <div className="timeline-craft-edge" onMouseDown={startEdgeDrag(i, 'end')} style={{ position: 'absolute', top: 0, bottom: 0, right: 0, cursor: 'ew-resize', opacity: sel ? 0.9 : 0.55 }} />
              </div>
            );
          })}
        </div>

        {/* 麦克风轨始终占位：无音频时仍保留与视频轨相同高度，便于后续对齐配音。 */}
        <AudioLane
          clips={clips}
          px={px}
          hasAudio={hasAudio}
          peaks={audioPeaks}
          durationMs={durationMs}
          label={labels.mic}
          viewportScrollLeft={viewportScrollLeft}
          viewportWidth={viewportWidth}
          contentWidth={contentWidth}
          visibleStartMs={visibleStartMs}
          visibleEndMs={visibleEndMs}
        />
        {hasCaptions && (
          <CaptionLane
            cues={captionCues}
            px={px}
            label={labels.captions}
            visibleStartMs={visibleStartMs}
            visibleEndMs={visibleEndMs}
          />
        )}

        {onAutoZoomChange && (
          <div
            data-testid="autozoom-track"
            className="timeline-craft-autozoom-track"
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(event) => {
              event.preventDefault();
              // Chrome / Playwright 对自定义 drag MIME 的保留方式不同；这个轨道是唯一 drop target，
              // 因而在此处直接创建，保证鼠标和触控板拖入都可靠。
              addZoomAt(srcAtClientX(event.clientX));
            }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onScrub(srcAtClientX(event.clientX));
            }}
            style={{ position: 'relative', height: 34, marginTop: 6, cursor: 'copy' }}
            aria-label={labels.autoZoom}
          >
            <span className="timeline-craft-autozoom-label">{labels.autoZoom}</span>
            {autoZooms.map((zoom) => {
              const selected = selectedAutoZoomId === zoom.id;
              return (
                <div
                  key={zoom.id}
                  data-testid="autozoom-segment"
                  data-zoom-range={`${zoom.start}-${zoom.end}`}
                  className={`timeline-craft-autozoom-segment${selected ? ' is-selected' : ''}`}
                  onMouseDown={startZoomDrag(zoom.id, 'move')}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onAutoZoomChange(autoZooms.filter((item) => item.id !== zoom.id));
                    if (selected) onAutoZoomSelect?.(null);
                  }}
                  style={{ position: 'absolute', top: 5, bottom: 5, left: px(zoom.start), width: Math.max(12, px(zoom.end - zoom.start)) }}
                  title={`${labels.autoZoom} · ${fmt(zoom.start)}–${fmt(zoom.end)}`}
                >
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startZoomDrag(zoom.id, 'start')} />
                  {editingZoomId === zoom.id ? (
                    <input
                      data-testid="autozoom-scale-input"
                      autoFocus
                      aria-label={`${labels.autoZoom} scale`}
                      type="number"
                      min={1.05}
                      max={4}
                      step={0.05}
                      value={zoom.scale}
                      onMouseDown={(event) => { event.stopPropagation(); }}
                      onClick={(event) => { event.stopPropagation(); }}
                      onChange={(event) => updateZoomScale(zoom.id, event.target.value)}
                      onBlur={() => setEditingZoomId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'Escape') {
                          event.preventDefault();
                          setEditingZoomId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      data-testid="autozoom-scale"
                      type="button"
                      aria-label={`${labels.autoZoom} scale ×${zoom.scale.toFixed(1)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAutoZoomSelect?.(zoom.id);
                        setEditingZoomId(zoom.id);
                      }}
                      title={labels.editAutoZoomScale}
                    >
                      ×{zoom.scale.toFixed(1)}
                    </button>
                  )}
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startZoomDrag(zoom.id, 'end')} />
                </div>
              );
            })}
          </div>
        )}

        {onHighlightChange && (
          <EffectLane label={labels.highlight} testId="highlight-track">
            {highlights.map((item) => {
              const selected = selectedHighlightId === item.id;
              return (
                <div
                  key={item.id}
                  data-testid="highlight-segment"
                  className={`timeline-craft-effect-segment is-highlight${selected ? ' is-selected' : ''}`}
                  onMouseDown={startEffectDrag(item, 'move', replaceHighlight, (id) => onHighlightSelect?.(id))}
                  onDoubleClick={() => onHighlightSelect?.(item.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onHighlightChange(highlights.filter((candidate) => candidate.id !== item.id));
                    if (selected) onHighlightSelect?.(null);
                  }}
                  style={{ left: px(item.start), width: Math.max(12, px(item.end - item.start)) }}
                >
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startEffectDrag(item, 'start', replaceHighlight, (id) => onHighlightSelect?.(id))} />
                  <span>{labels.highlight}</span>
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startEffectDrag(item, 'end', replaceHighlight, (id) => onHighlightSelect?.(id))} />
                </div>
              );
            })}
          </EffectLane>
        )}

        {onKeyPointMotionChange && keyPointMotions.length > 0 && (
          <EffectLane label={labels.keyPointMotion} testId="keypoint-motion-track">
            {keyPointMotions.map((item) => {
              const selected = selectedKeyPointMotionId === item.id;
              return (
                <div
                  key={item.id}
                  data-testid="keypoint-motion-segment"
                  className={`timeline-craft-effect-segment is-keypoint${selected ? ' is-selected' : ''}`}
                  onMouseDown={startEffectDrag(item, 'move', replaceKeyPointMotion, (id) => onKeyPointMotionSelect?.(id))}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onKeyPointMotionChange(keyPointMotions.filter((candidate) => candidate.id !== item.id));
                    if (selected) onKeyPointMotionSelect?.(null);
                  }}
                  style={{ left: px(item.start), width: Math.max(12, px(item.end - item.start)) }}
                  title={item.title}
                >
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startEffectDrag(item, 'start', replaceKeyPointMotion, (id) => onKeyPointMotionSelect?.(id))} />
                  <span>{item.title}</span>
                  <i className="timeline-craft-autozoom-edge" onMouseDown={startEffectDrag(item, 'end', replaceKeyPointMotion, (id) => onKeyPointMotionSelect?.(id))} />
                </div>
              );
            })}
          </EffectLane>
        )}

        {/* 播放头：竖线贯穿 + 标尺上的三角手柄 */}
        <div className="timeline-craft-playhead" style={{ position: 'absolute', top: 0, bottom: 0, left: px(playheadMs) - 1, pointerEvents: 'none', zIndex: 5 }} />
        <div
          onMouseDown={startScrub}
          className="timeline-craft-grip tl-grip"
          style={{ position: 'absolute', top: -4, left: px(playheadMs) - 6, width: 12, height: 12, cursor: 'ew-resize', zIndex: 6 }}
          aria-label="playhead"
        />
        </div>
      </div>

      {selectedHighlightId && onHighlightChange && (() => {
        const item = highlights.find((candidate) => candidate.id === selectedHighlightId);
        if (!item) return null;
        const setEffect = (key: keyof HighlightEffectSegment['enabled'], enabled: boolean) => {
          replaceHighlight(item.id, { enabled: { ...item.enabled, [key]: enabled } });
        };
        return (
          <div className="timeline-craft-highlight-editor" data-testid="highlight-editor">
            <label><input type="checkbox" checked={item.enabled.spotlight} onChange={(event) => setEffect('spotlight', event.target.checked)} /> {labels.spotlight}</label>
            <label><input type="checkbox" checked={item.enabled.focusFrame} onChange={(event) => setEffect('focusFrame', event.target.checked)} /> {labels.focusFrame}</label>
            <label><input type="checkbox" checked={item.enabled.cursorHalo} onChange={(event) => setEffect('cursorHalo', event.target.checked)} /> {labels.cursorHalo}</label>
            <label><input type="checkbox" checked={item.enabled.textCallout} onChange={(event) => setEffect('textCallout', event.target.checked)} /> {labels.textCallout}</label>
            <label className="timeline-craft-effect-opacity">
              <span>{labels.opacity}</span>
              <input type="range" min="0" max="0.9" step="0.05" value={item.spotlightOpacity} onChange={(event) => replaceHighlight(item.id, { spotlightOpacity: Number(event.target.value) })} />
            </label>
            <input
              value={item.calloutText ?? ''}
              maxLength={240}
              disabled={!item.enabled.textCallout}
              onChange={(event) => replaceHighlight(item.id, { calloutText: event.target.value })}
              placeholder={labels.calloutText}
              aria-label={labels.calloutText}
            />
            <button type="button" aria-label="Delete highlight" onClick={() => {
              onHighlightChange(highlights.filter((candidate) => candidate.id !== item.id));
              onHighlightSelect?.(null);
            }}><I.Trash size={11} /></button>
          </div>
        );
      })()}

      {selectedKeyPointMotionId && onKeyPointMotionChange && (() => {
        const item = keyPointMotions.find((candidate) => candidate.id === selectedKeyPointMotionId);
        if (!item) return null;
        return (
          <div className="timeline-craft-keypoint-editor" data-testid="keypoint-motion-editor">
            <input value={item.title} maxLength={120} onChange={(event) => replaceKeyPointMotion(item.id, { title: event.target.value })} aria-label="Key point title" />
            <input value={item.bullets.join(' · ')} maxLength={360} onChange={(event) => replaceKeyPointMotion(item.id, { bullets: event.target.value.split('·').map((value) => value.trim()).filter(Boolean).slice(0, 4) })} aria-label="Key point bullets" />
            <select value={item.kind} onChange={(event) => replaceKeyPointMotion(item.id, { kind: event.target.value as KeyPointMotionSegment['kind'] })} aria-label="Key point layout">
              <option value="chapter_title">Chapter</option>
              <option value="side_card">Side card</option>
              <option value="lower_third">Lower third</option>
            </select>
            <select value={item.placement} onChange={(event) => replaceKeyPointMotion(item.id, { placement: event.target.value as KeyPointMotionSegment['placement'] })} aria-label="Key point placement">
              {['auto', 'left', 'right', 'top', 'bottom'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <label><input type="checkbox" checked={item.enabled} onChange={(event) => replaceKeyPointMotion(item.id, { enabled: event.target.checked })} /> On</label>
            <button type="button" onClick={() => {
              onKeyPointMotionChange(keyPointMotions.filter((candidate) => candidate.id !== item.id));
              onKeyPointMotionSelect?.(null);
            }}><I.Trash size={11} /></button>
          </div>
        );
      })()}

      <div className="timeline-craft-hint mt-1.5 flex items-center justify-between">
        <span>{labels.hint}</span>
        <span data-testid="timeline-current-time" data-playhead-ms={Math.round(playheadMs)}>{fmt(playheadMs)}</span>
      </div>
    </div>
  );
}

function EffectLane({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }): JSX.Element {
  return (
    <div data-testid={testId} className="timeline-craft-effect-track" style={{ position: 'relative', height: 34, marginTop: 6 }} aria-label={label}>
      <span className="timeline-craft-autozoom-label">{label}</span>
      {children}
    </div>
  );
}

function AudioLane({
  clips, px, hasAudio, peaks, durationMs, label,
  viewportScrollLeft, viewportWidth, contentWidth, visibleStartMs, visibleEndMs,
}: {
  clips: TimeSegment[];
  px: (ms: number) => number;
  hasAudio: boolean;
  peaks: number[];
  durationMs: number;
  label: string;
  viewportScrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  visibleStartMs: number;
  visibleEndMs: number;
}): JSX.Element {
  return (
    <div
      data-testid="timeline-audio-track"
      className={`timeline-craft-mirror timeline-craft-audio-lane${hasAudio ? '' : ' is-silent'}`}
      style={{ position: 'relative', height: 30, marginTop: 4, overflow: 'hidden', borderRadius: 6, background: hasAudio ? 'rgba(186, 227, 202, .45)' : 'rgba(251, 216, 222, .72)' }}
      title={label}
    >
      <div className="flex items-center gap-1 timeline-craft-label" style={{ position: 'absolute', left: 5, top: 0, bottom: 0, zIndex: 2, fontSize: 9, pointerEvents: 'none', opacity: hasAudio ? 0.72 : 0.58 }}>
        <I.Mic size={11} />
      </div>
      {hasAudio && peaks.length > 0 && (
        <WaveformCanvas
          peaks={peaks}
          clips={clips}
          durationMs={durationMs}
          viewportScrollLeft={viewportScrollLeft}
          viewportWidth={viewportWidth}
          contentWidth={contentWidth}
          visibleStartMs={visibleStartMs}
          visibleEndMs={visibleEndMs}
        />
      )}
      {hasAudio && peaks.length === 0 && clips.map((clip, index) => (
        <div key={index} style={{ position: 'absolute', top: 5, bottom: 5, left: px(clip.start), width: px(clip.end - clip.start), background: 'var(--hi-soft)', opacity: 0.78 }} />
      ))}
    </div>
  );
}

function WaveformCanvas({
  peaks, clips, durationMs, viewportScrollLeft, viewportWidth, contentWidth, visibleStartMs, visibleEndMs,
}: {
  peaks: number[];
  clips: TimeSegment[];
  durationMs: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  visibleStartMs: number;
  visibleEndMs: number;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(22, 112, 72, .78)';
      ctx.lineWidth = 1;
      const middle = height / 2;
      for (let x = 0; x < width; x += 2) {
        const sourceTime = visibleStartMs + (x / width) * (visibleEndMs - visibleStartMs);
        if (!clips.some((clip) => sourceTime >= clip.start && sourceTime <= clip.end)) continue;
        const peak = peaks[Math.min(peaks.length - 1, Math.floor((sourceTime / durationMs) * peaks.length))] ?? 0;
        const amplitude = Math.max(1, peak * (height / 2 - 2));
        ctx.beginPath();
        ctx.moveTo(x + 0.5, middle - amplitude);
        ctx.lineTo(x + 0.5, middle + amplitude);
        ctx.stroke();
      }
    };
    draw();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [clips, durationMs, peaks, visibleEndMs, visibleStartMs]);
  const left = Math.min(contentWidth, viewportScrollLeft + 22);
  const width = Math.max(1, Math.min(Math.max(1, viewportWidth - 22), contentWidth - left));
  return (
    <canvas
      data-testid="timeline-audio-waveform"
      data-visible-start={Math.round(visibleStartMs)}
      data-visible-end={Math.round(visibleEndMs)}
      ref={ref}
      style={{ position: 'absolute', left, top: 2, width, height: 'calc(100% - 4px)' }}
    />
  );
}

function CaptionLane({
  cues, px, label, visibleStartMs, visibleEndMs,
}: {
  cues: SubtitleCue[];
  px: (ms: number) => number;
  label: string;
  visibleStartMs: number;
  visibleEndMs: number;
}): JSX.Element {
  const buffer = Math.max(500, (visibleEndMs - visibleStartMs) * 0.15);
  const visibleCues = cues.filter((cue) => cue.endMs >= visibleStartMs - buffer && cue.startMs <= visibleEndMs + buffer);
  return (
    <div data-testid="timeline-caption-track" className="timeline-craft-mirror" style={{ position: 'relative', height: 18, marginTop: 3, overflow: 'hidden' }}>
      <span className="timeline-craft-label" style={{ position: 'absolute', left: 3, top: 2, zIndex: 2 }}><I.Subtitles size={10} /></span>
      {visibleCues.map((cue) => (
        <div
          key={`${cue.index}-${cue.startMs}`}
          data-testid="timeline-caption-cue"
          data-cue-start={cue.startMs}
          style={{
            position: 'absolute', top: 2, bottom: 2,
            left: px(cue.startMs),
            width: Math.max(4, px(cue.endMs - cue.startMs)),
            borderRadius: 4, background: 'var(--pro)', opacity: 0.78,
          }}
          title={`${label}: ${cue.text}`}
        />
      ))}
    </div>
  );
}
