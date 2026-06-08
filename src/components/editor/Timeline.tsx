'use client';

import { useRef, type JSX } from 'react';
import { I } from '@/components/icons';

interface Props {
  durationMs: number;
  /** 保留区间 [inMs, outMs]（ms）。 */
  inMs: number;
  outMs: number;
  /** 拖动时持续回调（页面据此更新状态 + 去抖持久化）。 */
  onChange: (inMs: number, outMs: number) => void;
  hasAudio: boolean;
  hasCaptions: boolean;
  labels: { split: string; trim: string; reset: string; kept: string; canvas: string; mic: string; captions: string };
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 时间轴裁剪（单 in/out 段）：拖左右手柄设保留区间，框外（裁掉部分）变暗。
 * 导出按 [inMs,outMs] 输出（见 exportPipeline 的 segments）。多段 split 留作后续。
 */
export function Timeline({ durationMs, inMs, outMs, onChange, hasAudio, hasCaptions, labels }: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, durationMs);
  const pctIn = (inMs / dur) * 100;
  const pctOut = (outMs / dur) * 100;
  const trimmed = inMs > 0 || outMs < durationMs;

  const startDrag = (which: 'in' | 'out') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = trackRef.current;
    if (!el) return;
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const t = Math.round(ratio * durationMs);
      if (which === 'in') onChange(Math.min(t, outMs - 500), outMs);
      else onChange(inMs, Math.max(t, inMs + 500));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const handleStyle: React.CSSProperties = {
    position: 'absolute', top: -3, bottom: -3, width: 12, background: 'var(--hi)', border: '1.6px solid var(--ink)',
    borderRadius: 2, cursor: 'ew-resize', zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ background: 'var(--paper)', border: '1.8px solid var(--ink)', borderRadius: 4, boxShadow: '4px 4px 0 var(--ink)', padding: 10 }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>
            {labels.trim}
          </span>
          {trimmed && (
            <button type="button" onClick={() => onChange(0, durationMs)} className="btn-sketch" style={{ padding: '3px 8px', fontSize: 9 }}>
              {labels.reset}
            </button>
          )}
        </div>
        <span className="label-mono">{labels.kept} · {fmt(outMs - inMs)} / {fmt(durationMs)}</span>
      </div>

      <div ref={trackRef} style={{ position: 'relative', userSelect: 'none' }}>
        {/* 轨道 */}
        <div style={{ display: 'grid', gap: 6, border: '1.3px solid var(--ink)', borderRadius: 3, background: 'var(--paper)', padding: 8 }}>
          <Track icon={<I.Monitor size={12} />} label={labels.canvas} fill="var(--paper-2)" />
          {hasAudio && <Track icon={<I.Mic size={12} />} label={labels.mic} fill="var(--hi-soft)" />}
          {hasCaptions && <Track icon={<I.Subtitles size={12} />} label={labels.captions} fill="var(--pro)" />}
        </div>

        {/* 裁掉部分变暗（覆盖在轨道上，跳过左侧 label 列 90px） */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 90 + 8, right: 8, pointerEvents: 'none' }}>
          <div style={{ position: 'relative', height: '100%' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pctIn}%`, background: 'rgba(245,243,235,0.7)' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pctOut}%`, right: 0, background: 'rgba(245,243,235,0.7)' }} />
            {/* 保留区边框 */}
            <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${pctIn}%`, width: `${pctOut - pctIn}%`, border: '2px solid var(--ink)', borderRadius: 2, pointerEvents: 'none' }} />
            {/* 手柄（可点） */}
            <div style={{ ...handleStyle, left: `calc(${pctIn}% - 6px)`, pointerEvents: 'auto' }} onMouseDown={startDrag('in')} />
            <div style={{ ...handleStyle, left: `calc(${pctOut}% - 6px)`, pointerEvents: 'auto' }} onMouseDown={startDrag('out')} />
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-3)', paddingLeft: 98 }}>
        <span>{fmt(inMs)}</span>
        <span>{fmt(outMs)}</span>
      </div>
    </div>
  );
}

function Track({ icon, label, fill }: { icon: React.ReactNode; label: string; fill: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-shrink-0 items-center gap-1.5" style={{ width: 90, fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {icon} {label}
      </div>
      <div className="flex-1" style={{ height: 22, background: fill, border: '1.2px solid var(--ink)', borderRadius: 2 }} />
    </div>
  );
}
