'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { I } from '@/components/icons';
import { AutoEditControl } from '@/components/editor/AutoEditControl';
import type { AutoEditMode, AutoEditResult } from '@/services/autoEditAnalyzer';
import type { AutoZoomSegment, TimeSegment } from '@/types/recording';
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
  /** 本地静音分析；结果仍写入既有的 clips/segments，而非重编码原始媒体。 */
  autoEdit?: {
    phase: 'idle' | 'analyzing' | 'applied' | 'failed';
    result: AutoEditResult | null;
    error: string | null;
    onRun: (preset: AutoEditMode) => void;
    onUndo: () => void;
    labels: {
      autoEdit: string; chatCut: string; lecture: string; walkthrough: string; shorts: string; timing: string;
      gentle: string; standard: string; tight: string; analyzing: string; noAudio: string;
      removed: (cuts: number, seconds: string) => string; noCuts: string; sceneAware: (transitions: number, alignedCuts: number) => string; undo: string;
    };
  };
  hasAudio: boolean;
  hasCaptions: boolean;
  labels: {
    edit: string; reset: string; kept: string; mic: string; captions: string;
    split: string; deleteClip: string; hint: string;
    autoZoom: string; autoZoomHint: string; editAutoZoomScale: string;
  };
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
  autoEdit,
  hasAudio, hasCaptions, labels,
}: Props): JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, durationMs);
  const trimmed = !(clips.length === 1 && clips[0].start <= 0 && clips[0].end >= durationMs);
  const kept = keptDuration(clips);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editingZoomId, setEditingZoomId] = useState<string | null>(null);

  const pct = (ms: number) => (ms / dur) * 100;

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
    const el = laneRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(ratio * durationMs);
  };

  // 在标尺/空白处按下：移动播放头并持续 scrub（拖动 = 刮擦预览）
  const startScrub = (e: React.MouseEvent) => {
    e.preventDefault();
    onScrub(srcAtClientX(e.clientX));
    const move = (ev: MouseEvent) => onScrub(srcAtClientX(ev.clientX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 拖片段边缘 Trim：基于拖拽起点的 clips 重算（幂等、无漂移），并实时 scrub 到该边缘
  const startEdgeDrag = (i: number, side: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(i);
    const base = clips.map((s) => ({ ...s }));
    const move = (ev: MouseEvent) => {
      const t = srcAtClientX(ev.clientX);
      onChange(trimSegmentEdge(base, i, side, t));
      onScrub(t);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
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

  const startZoomDrag = (id: string, mode: 'move' | 'start' | 'end') => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
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
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
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

  const canDelete = selectedIdx != null && clips.length > 1;

  return (
    <div className="timeline-craft-panel">
      <div className="timeline-craft-toolbar mb-2 flex items-center justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
          {autoEdit && (
            <AutoEditControl
              hasAudio={hasAudio}
              phase={autoEdit.phase}
              result={autoEdit.result}
              error={autoEdit.error}
              onRun={autoEdit.onRun}
              onUndo={autoEdit.onUndo}
              labels={autoEdit.labels}
            />
          )}
          {trimmed && (
            <button type="button" onClick={() => { onReset(); setSelectedIdx(null); }} className="timeline-craft-action btn-sketch" style={{ padding: '3px 8px' }}>
              {labels.reset}
            </button>
          )}
        </div>
        <span className="timeline-craft-kept label-mono">{labels.kept} · {fmt(kept)} / {fmt(durationMs)}</span>
      </div>

      <div ref={laneRef} className="timeline-craft-lane" style={{ position: 'relative', userSelect: 'none' }}>
        {/* 标尺：拖动刮擦预览 */}
        <div className="timeline-craft-ruler" onMouseDown={startScrub} style={{ height: 14, cursor: 'ew-resize' }} />

        {/* 片段轨：整轨可拖刮擦（空白/gap 处）；clips=block 可点选 + 边缘 Trim；gap 变暗 */}
        <div data-testid="timeline-video-track" className="timeline-craft-track" onMouseDown={startScrub} style={{ position: 'relative', height: 30, overflow: 'hidden', cursor: 'ew-resize' }}>
          {gaps.map((g, i) => (
            <div key={`g${i}`} className="timeline-craft-gap" style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(g.start)}%`, width: `${pct(g.end - g.start)}%` }} />
          ))}
          {clips.map((c, i) => {
            const sel = selectedIdx === i;
            return (
              <div
                key={`c${i}`}
                className={`timeline-craft-clip${sel ? ' is-selected' : ''}`}
                onMouseDown={(e) => { e.stopPropagation(); setSelectedIdx(i); startScrub(e); }}
                style={{
                  position: 'absolute', top: 2, bottom: 2, left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%`,
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
        <AudioLane clips={clips} pct={pct} hasAudio={hasAudio} label={labels.mic} />
        {hasCaptions && <MirrorBar clips={clips} pct={pct} fill="var(--pro)" icon={<I.Subtitles size={10} />} label={labels.captions} />}

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
                  style={{ position: 'absolute', top: 5, bottom: 5, left: `${pct(zoom.start)}%`, width: `${Math.max(1.2, pct(zoom.end - zoom.start))}%` }}
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

        {/* 播放头：竖线贯穿 + 标尺上的三角手柄 */}
        <div className="timeline-craft-playhead" style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pct(playheadMs)}% - 1px)`, pointerEvents: 'none', zIndex: 5 }} />
        <div
          onMouseDown={startScrub}
          className="timeline-craft-grip tl-grip"
          style={{ position: 'absolute', top: -4, left: `calc(${pct(playheadMs)}% - 6px)`, width: 12, height: 12, cursor: 'ew-resize', zIndex: 6 }}
          aria-label="playhead"
        />
      </div>

      <div className="timeline-craft-hint mt-1.5 flex items-center justify-between">
        <span>{labels.hint}</span>
        <span>{fmt(playheadMs)}</span>
      </div>
    </div>
  );
}

function AudioLane({ clips, pct, hasAudio, label }: {
  clips: TimeSegment[]; pct: (ms: number) => number; hasAudio: boolean; label: string;
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
      {hasAudio && clips.map((clip, index) => (
        <div key={index} style={{ position: 'absolute', top: 5, bottom: 5, left: `${pct(clip.start)}%`, width: `${pct(clip.end - clip.start)}%`, background: 'var(--hi-soft)', opacity: 0.78 }} />
      ))}
    </div>
  );
}

function MirrorBar({ clips, pct, fill, icon, label }: {
  clips: TimeSegment[]; pct: (ms: number) => number; fill: string; icon: React.ReactNode; label: string;
}): JSX.Element {
  return (
    <div className="timeline-craft-mirror" style={{ position: 'relative', height: 12, marginTop: 3 }}>
      <div className="flex items-center gap-1 timeline-craft-label" style={{ position: 'absolute', left: 3, top: 0, bottom: 0, zIndex: 2, fontSize: 8, pointerEvents: 'none' }}>
        {icon}
      </div>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {clips.map((c, i) => (
          <div key={i} style={{ position: 'absolute', top: 1, bottom: 1, left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%`, background: fill, opacity: 0.7 }} title={label} />
        ))}
      </div>
    </div>
  );
}
