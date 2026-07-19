'use client';

import { type CSSProperties, type JSX } from 'react';
import { I } from '@/components/icons';
import type { AutoZoomSegment } from '@/types/recording';

interface Props {
  durationMs: number;
  playheadMs: number;
  autoZooms: AutoZoomSegment[];
  onChange: (next: AutoZoomSegment[]) => void;
  en: boolean;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function AutoZoomPanel({ durationMs, playheadMs, autoZooms, onChange, en }: Props): JSX.Element {
  const addZoom = () => {
    const start = Math.max(0, Math.round(playheadMs));
    const end = Math.min(durationMs, start + 2200);
    onChange([
      ...autoZooms,
      { id: `az-${Date.now().toString(36)}`, start, end, scale: 1.6, cx: 0.5, cy: 0.5 },
    ].sort((a, b) => a.start - b.start));
  };

  const update = (id: string, patch: Partial<AutoZoomSegment>) => {
    onChange(autoZooms.map((z) => {
      if (z.id !== id) return z;
      const next = { ...z, ...patch };
      next.start = Math.max(0, Math.min(durationMs - 100, Math.round(next.start)));
      next.end = Math.max(next.start + 100, Math.min(durationMs, Math.round(next.end)));
      next.scale = Math.max(1.05, Math.min(4, Number(next.scale)));
      return next;
    }).sort((a, b) => a.start - b.start));
  };

  const remove = (id: string) => onChange(autoZooms.filter((z) => z.id !== id));

  return (
    <section
      className="mt-3"
      style={{
        background: '#fffdf8',
        border: '1px solid rgba(24,25,26,0.08)',
        borderRadius: 20,
        padding: 14,
        boxShadow: '0 10px 28px rgba(48,38,26,0.06), inset 0 1px 0 rgba(255,255,255,0.76)',
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div style={{ fontSize: 13, fontWeight: 760, color: 'var(--ink)' }}>Autozoom</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
            {en ? 'Zoom a selected time window for detail.' : '在指定时间窗口内放大画面细节。'}
          </div>
        </div>
        <button type="button" className="btn-sketch" onClick={addZoom} style={{ padding: '5px 10px', fontSize: 10 }}>
          <I.Search size={12} /> {en ? 'Add' : '添加'}
        </button>
      </div>

      {autoZooms.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
          {en ? 'Move the playhead, then add an autozoom segment.' : '移动播放头后添加 autozoom 段。'}
        </div>
      ) : (
        <div className="space-y-2">
          {autoZooms.map((z) => (
            <div
              key={z.id}
              style={{
                border: '1px solid rgba(31,34,37,.12)',
                borderRadius: 16,
                background: 'var(--paper-2)',
                padding: 10,
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-2)' }}>
                  {fmt(z.start)} – {fmt(z.end)}
                </span>
                <button type="button" onClick={() => remove(z.id)} aria-label={en ? 'Remove autozoom' : '删除 autozoom'} style={{ border: 'none', background: 'transparent', color: 'var(--rec)', cursor: 'pointer' }}>
                  <I.Trash size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {en ? 'Start' : '开始'}
                  <input type="number" value={Math.round(z.start / 1000)} min={0} max={Math.floor(durationMs / 1000)} onChange={(e) => update(z.id, { start: Number(e.target.value) * 1000 })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {en ? 'Duration' : '时长'}
                  <input type="number" value={Math.max(0.1, Math.round((z.end - z.start) / 100) / 10)} min={0.1} step={0.1} onChange={(e) => update(z.id, { end: z.start + Number(e.target.value) * 1000 })} style={inputStyle} />
                </label>
                <label style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {en ? 'Scale' : '倍率'}
                  <input type="number" value={z.scale} min={1.05} max={4} step={0.05} onChange={(e) => update(z.id, { scale: Number(e.target.value) })} style={inputStyle} />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  border: '1px solid rgba(31,34,37,.14)',
  borderRadius: 10,
  background: '#fffdf8',
  padding: '6px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink)',
};
