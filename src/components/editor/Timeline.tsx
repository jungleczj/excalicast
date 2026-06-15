'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { I } from '@/components/icons';
import type { TimeSegment } from '@/types/recording';
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
  hasAudio: boolean;
  hasCaptions: boolean;
  labels: {
    edit: string; reset: string; kept: string; mic: string; captions: string;
    split: string; deleteClip: string; hint: string;
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
  durationMs, clips, playheadMs, onScrub, onChange, onReset, hasAudio, hasCaptions, labels,
}: Props): JSX.Element {
  const laneRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, durationMs);
  const trimmed = !(clips.length === 1 && clips[0].start <= 0 && clips[0].end >= durationMs);
  const kept = keptDuration(clips);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

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
    <div style={{ background: 'var(--paper)', border: '1.8px solid var(--ink)', borderRadius: 4, boxShadow: '4px 4px 0 var(--ink)', padding: 10 }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)', marginRight: 4 }}>
            {labels.edit}
          </span>
          <button type="button" onClick={doSplit} className="btn-sketch" style={{ padding: '3px 9px', fontSize: 9 }} title={`${labels.split} (S)`}>
            <span style={{ fontSize: 11 }}>✂</span> {labels.split}
          </button>
          <button type="button" onClick={doDelete} disabled={!canDelete} className="btn-sketch" style={{ padding: '3px 9px', fontSize: 9, color: canDelete ? 'var(--rec)' : undefined, borderColor: canDelete ? 'var(--rec)' : undefined }} title={`${labels.deleteClip} (Del)`}>
            <I.Trash size={11} /> {labels.deleteClip}
          </button>
          {trimmed && (
            <button type="button" onClick={() => { onReset(); setSelectedIdx(null); }} className="btn-sketch" style={{ padding: '3px 8px', fontSize: 9 }}>
              {labels.reset}
            </button>
          )}
        </div>
        <span className="label-mono">{labels.kept} · {fmt(kept)} / {fmt(durationMs)}</span>
      </div>

      <div ref={laneRef} style={{ position: 'relative', userSelect: 'none' }}>
        {/* 标尺：拖动刮擦预览 */}
        <div onMouseDown={startScrub} style={{ height: 14, background: 'var(--paper-2)', border: '1.2px solid var(--ink)', borderBottom: 'none', borderRadius: '3px 3px 0 0', cursor: 'ew-resize' }} />

        {/* 片段轨：clips=block，可点选 + 边缘 Trim；gap 变暗 */}
        <div style={{ position: 'relative', height: 30, border: '1.2px solid var(--ink)', background: 'var(--paper-3)', overflow: 'hidden' }}>
          {gaps.map((g, i) => (
            <div key={`g${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(g.start)}%`, width: `${pct(g.end - g.start)}%`, background: 'rgba(26,26,26,0.34)', borderLeft: '1px dashed var(--ink)', borderRight: '1px dashed var(--ink)' }} />
          ))}
          {clips.map((c, i) => {
            const sel = selectedIdx === i;
            return (
              <div
                key={`c${i}`}
                onMouseDown={(e) => { e.stopPropagation(); setSelectedIdx(i); onScrub(srcAtClientX(e.clientX)); }}
                style={{
                  position: 'absolute', top: 2, bottom: 2, left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%`,
                  background: sel ? 'var(--hi)' : 'var(--hi-soft)',
                  border: `1.4px solid var(--ink)`, borderRadius: 2,
                  boxShadow: sel ? '2px 2px 0 var(--ink)' : 'none',
                  cursor: 'pointer', overflow: 'hidden',
                }}
              >
                {/* 左右 Trim 手柄 */}
                <div onMouseDown={startEdgeDrag(i, 'start')} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 7, cursor: 'ew-resize', background: 'var(--ink)', opacity: sel ? 0.9 : 0.55 }} />
                <div onMouseDown={startEdgeDrag(i, 'end')} style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 7, cursor: 'ew-resize', background: 'var(--ink)', opacity: sel ? 0.9 : 0.55 }} />
              </div>
            );
          })}
        </div>

        {/* 麦克风 / 字幕 视觉镜像条（跟随 clips，非交互） */}
        {hasAudio && <MirrorBar clips={clips} pct={pct} fill="var(--hi-soft)" icon={<I.Mic size={10} />} label={labels.mic} />}
        {hasCaptions && <MirrorBar clips={clips} pct={pct} fill="var(--pro)" icon={<I.Subtitles size={10} />} label={labels.captions} />}

        {/* 播放头：竖线贯穿 + 标尺上的三角手柄 */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${pct(playheadMs)}% - 1px)`, width: 2, background: 'var(--ink)', pointerEvents: 'none', zIndex: 5 }} />
        <div
          onMouseDown={startScrub}
          className="tl-grip"
          style={{ position: 'absolute', top: -4, left: `calc(${pct(playheadMs)}% - 6px)`, width: 12, height: 12, background: 'var(--hi)', border: '1.6px solid var(--ink)', borderRadius: 2, cursor: 'ew-resize', zIndex: 6 }}
          aria-label="playhead"
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-3)' }}>
        <span>{labels.hint}</span>
        <span>{fmt(playheadMs)}</span>
      </div>
    </div>
  );
}

function MirrorBar({ clips, pct, fill, icon, label }: {
  clips: TimeSegment[]; pct: (ms: number) => number; fill: string; icon: React.ReactNode; label: string;
}): JSX.Element {
  return (
    <div style={{ position: 'relative', height: 12, marginTop: 3 }}>
      <div className="flex items-center gap-1" style={{ position: 'absolute', left: 3, top: 0, bottom: 0, zIndex: 2, fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--ink-3)', pointerEvents: 'none' }}>
        {icon}
      </div>
      <div style={{ position: 'absolute', inset: 0, border: '1px solid var(--ink)', borderRadius: 2, background: 'var(--paper-3)', overflow: 'hidden' }}>
        {clips.map((c, i) => (
          <div key={i} style={{ position: 'absolute', top: 1, bottom: 1, left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%`, background: fill, opacity: 0.7 }} title={label} />
        ))}
      </div>
    </div>
  );
}
