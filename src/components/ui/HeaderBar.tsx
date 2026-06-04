import type { CSSProperties, JSX } from 'react';
import { Link } from '@/i18n/navigation';
import { I, LogoMark } from '@/components/icons';

/**
 * Marketing header, ported from design `parts/shared.jsx` HeaderBar, made
 * responsive: nav links collapse on mobile (logo + CTA always visible).
 * `items` hrefs are locale-relative (i18n Link). Presentational.
 */
export interface NavItem {
  label: string;
  href: string;
}

export function HeaderBar({
  active,
  items,
  ctaLabel = 'Start recording',
  ctaHref = '/app',
  dark = false,
}: {
  active?: string;
  items: NavItem[];
  ctaLabel?: string;
  ctaHref?: string;
  dark?: boolean;
}): JSX.Element {
  const fg = dark ? 'var(--paper)' : 'var(--ink)';
  return (
    <header
      className="flex items-center justify-between px-4 sm:px-10"
      style={{
        width: '100%',
        borderBottom: '2px solid var(--ink)',
        background: dark ? 'var(--ink)' : 'var(--paper)',
        color: fg,
        height: 64,
        boxSizing: 'border-box',
      }}
    >
      <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none', color: fg }}>
        <LogoMark size={28} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
          Excalicast
        </span>
      </Link>

      <nav className="hidden items-center gap-8 md:flex">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={'nav-link' + (item.label === active ? ' is-active' : '')}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'currentColor',
              opacity: item.label === active ? 1 : 0.6,
              textDecoration: 'none',
              paddingBottom: 4,
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <Link href={ctaHref} className="btn-sketch btn-sketch-primary" style={{ padding: '9px 16px' }}>
          <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' } as CSSProperties} />
          {ctaLabel}
        </Link>
        <div
          className="hidden sm:flex"
          style={{
            width: 34,
            height: 34,
            border: '1.5px solid var(--ink)',
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            background: dark ? 'var(--ink)' : 'var(--paper)',
            color: fg,
          }}
        >
          <I.User size={16} />
        </div>
      </div>
    </header>
  );
}
