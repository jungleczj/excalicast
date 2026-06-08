import type { CSSProperties, ReactNode, JSX } from 'react';
import { I } from '@/components/icons';

/**
 * Sketch-Minimalist UI primitives, ported 1:1 from the ExcalidrawRec design
 * (`project/parts/shared.jsx`). Presentational only (no hooks) so they work in
 * Server Components. Visuals rely on tokens/classes in `globals.css`.
 */

/** Hard-offset card with hover lift. */
export function SketchCard({
  children,
  style = {},
  accent = false,
  hover = true,
  className = '',
}: {
  children: ReactNode;
  style?: CSSProperties;
  accent?: boolean;
  hover?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={[hover ? 'lift' : '', className].filter(Boolean).join(' ')}
      style={{
        background: 'var(--paper)',
        border: '1.6px solid var(--ink)',
        borderRadius: 4,
        boxShadow: accent ? '5px 5px 0 0 var(--hi)' : '3px 3px 0 0 var(--ink)',
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Yellow marker-highlighted inline text. */
export function Marker({
  children,
  color = 'var(--hi)',
  rotate = -0.4,
}: {
  children: ReactNode;
  color?: string;
  rotate?: number;
}): JSX.Element {
  return (
    <span
      style={
        {
          padding: '0 8px',
          display: 'inline-block',
          transform: `rotate(${rotate}deg)`,
          borderRadius: 2,
          // 设计稿：实心黄条 + 两侧 4px 外延（box-decoration-break 让换行也连续）
          background: color,
          boxShadow: `4px 0 0 ${color}, -4px 0 0 ${color}`,
          WebkitBoxDecorationBreak: 'clone',
          boxDecorationBreak: 'clone',
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}

/** Hand-written "tape" sticky label. */
export function TapeLabel({
  children,
  color = 'var(--hi)',
  rotate = -2,
  float = true,
  style = {},
}: {
  children: ReactNode;
  color?: string;
  rotate?: number;
  float?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <div
      className={'tape-wiggle ' + (float ? 'float-tilt' : '')}
      style={
        {
          display: 'inline-block',
          padding: '5px 14px',
          fontFamily: 'var(--font-hand)',
          fontWeight: 600,
          fontSize: 17,
          background: color,
          color: 'var(--ink)',
          border: '1.4px solid var(--ink)',
          transform: `rotate(${rotate}deg)`,
          boxShadow: '2px 2px 0 0 rgba(0,0,0,0.12)',
          borderRadius: 2,
          '--rot': `${rotate}deg`,
          '--tilt': `${rotate}deg`,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

export type MonoTagVariant = 'default' | 'hi' | 'rec' | 'pro' | 'max' | 'soft';

/** Mono metadata pill. */
export function MonoTag({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: MonoTagVariant;
}): JSX.Element {
  const styles: Record<MonoTagVariant, CSSProperties> = {
    default: { background: 'var(--paper)', color: 'var(--ink)', border: '1.2px solid var(--ink)' },
    hi: { background: 'var(--hi)', color: 'var(--ink)', border: '1.2px solid var(--ink)' },
    rec: { background: 'var(--rec)', color: 'white', border: '1.2px solid var(--rec)' },
    pro: { background: 'var(--pro)', color: 'var(--ink)', border: '1.2px solid var(--ink)' },
    max: { background: 'var(--max)', color: 'var(--ink)', border: '1.2px solid var(--ink)' },
    soft: { background: 'var(--paper-2)', color: 'var(--ink-2)', border: '1.2px solid var(--rule-soft)' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: 999,
        ...styles[variant],
      }}
    >
      {children}
    </span>
  );
}

/** Feature-list row with a hand-drawn checkbox. */
export function CheckRow({
  children,
  on = true,
  color,
}: {
  children: ReactNode;
  on?: boolean;
  color?: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '6px 0' }}>
      <div
        style={{
          width: 18,
          height: 18,
          marginTop: 2,
          border: '1.4px solid var(--ink)',
          borderRadius: 3,
          background: on ? color || 'var(--hi)' : 'var(--paper)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {on && <I.Check size={12} sw={2.4} />}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, color: on ? 'var(--ink)' : 'var(--ink-3)' }}>
        {children}
      </div>
    </div>
  );
}

/** Hand-drawn rectangle (two layered rough paths). */
export function RoughRect({
  width,
  height,
  fill = 'transparent',
  stroke = 'var(--ink)',
  sw = 1.5,
}: {
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  sw?: number;
}): JSX.Element {
  const w = width;
  const h = height;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" style={{ overflow: 'visible' }}>
      <path
        d={`M3 4 q${w * 0.5} -3 ${w - 6} 1 q3 ${h * 0.5} -1 ${h - 6} q-${w * 0.5} 3 -${w - 6} -1 q-3 -${h * 0.5} 1 -${h - 6} z`}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Hand-drawn arrow (quadratic curve + head). */
export function RoughArrow({
  x1,
  y1,
  x2,
  y2,
  stroke = 'var(--ink)',
  sw = 1.5,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  sw?: number;
}): JSX.Element {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 8;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const hl = 9;
  const a1 = ang - 0.5;
  const a2 = ang + 0.5;
  return (
    <g>
      <path d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <path
        d={`M${x2} ${y2} L${x2 - hl * Math.cos(a1)} ${y2 - hl * Math.sin(a1)} M${x2} ${y2} L${x2 - hl * Math.cos(a2)} ${y2 - hl * Math.sin(a2)}`}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </g>
  );
}
