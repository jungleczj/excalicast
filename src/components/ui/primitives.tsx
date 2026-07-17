import type { CSSProperties, ReactNode, JSX } from 'react';
import { I } from '@/components/icons';

/**
 * Shared UI primitives. They keep the old component API for compatibility,
 * but the presentation now follows the Craft-inspired system: quiet paper
 * surfaces, low-contrast hairlines, soft shadows, and restrained pills.
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
      className={['craft-ui-card', hover ? 'lift' : '', className].filter(Boolean).join(' ')}
      style={{
        background: accent
          ? 'linear-gradient(180deg, rgba(219,238,255,0.54), rgba(255,253,248,0.86))'
          : 'var(--craft-surface, rgba(255,253,248,0.86))',
        border: '1px solid var(--craft-line, rgba(24,25,26,0.09))',
        borderRadius: 30,
        boxShadow: 'var(--craft-shadow, 0 18px 46px rgba(48,38,26,0.08))',
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
          transform: rotate ? `rotate(${rotate / 4}deg)` : 'none',
          borderRadius: 4,
          background: color === 'var(--hi)'
            ? 'linear-gradient(180deg, transparent 58%, rgba(255,216,112,0.46) 58% 84%, transparent 84%)'
            : `linear-gradient(180deg, transparent 58%, ${color} 58% 84%, transparent 84%)`,
          boxShadow: 'none',
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
          padding: '6px 14px',
          fontFamily: 'var(--font-sans)',
          fontWeight: 650,
          fontSize: 13,
          background: color === 'var(--hi)' ? 'rgba(219,238,255,0.72)' : color,
          color: 'rgba(24,25,26,0.72)',
          border: '1px solid var(--craft-line, rgba(24,25,26,0.09))',
          transform: rotate ? `rotate(${rotate / 5}deg)` : 'none',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
          borderRadius: 999,
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
    default: { background: 'rgba(255,253,248,0.76)', color: 'rgba(24,25,26,0.66)', border: '1px solid var(--craft-line, rgba(24,25,26,0.09))' },
    hi: { background: 'rgba(219,238,255,0.72)', color: 'rgba(24,25,26,0.72)', border: '1px solid rgba(84,156,220,0.16)' },
    rec: { background: 'rgba(255,245,241,0.92)', color: 'var(--craft-danger, #df3f3b)', border: '1px solid rgba(223,63,59,0.18)' },
    pro: { background: 'rgba(202,234,211,0.56)', color: 'rgba(24,25,26,0.72)', border: '1px solid rgba(47,138,63,0.14)' },
    max: { background: 'rgba(221,210,242,0.58)', color: 'rgba(24,25,26,0.72)', border: '1px solid rgba(118,92,180,0.14)' },
    soft: { background: 'rgba(24,25,26,0.045)', color: 'rgba(24,25,26,0.52)', border: '1px solid var(--craft-line, rgba(24,25,26,0.09))' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 650,
        letterSpacing: '-0.01em',
        textTransform: 'none',
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
          border: '1px solid var(--craft-line, rgba(24,25,26,0.09))',
          borderRadius: 999,
          background: on ? color || 'rgba(219,238,255,0.72)' : 'rgba(255,253,248,0.78)',
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
