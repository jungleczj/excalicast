import type { CSSProperties, JSX } from 'react';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/icons';

/**
 * Marketing footer, ported 1:1 from design `parts/shared.jsx` FooterBar:
 * warm-dark, dot-grid background, highlighter keyline seam, brand block with
 * "made by humans" tape, 5 link columns (each with an accent bar + a Status
 * "operational" badge), and a bottom strip. Columns map to real routes where
 * they exist; the rest use "#" placeholders (as the design does). Responsive:
 * columns collapse on mobile. `minimal` variant kept for editor/export chrome.
 */

interface FLink {
  label: string;
  href: string;
  strong?: boolean;
  badge?: string;
}
interface FCol {
  title: string;
  links: FLink[];
}

const COLUMNS: FCol[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Changelog', href: '#' },
      { label: 'Roadmap', href: '#' },
      { label: 'Status', href: '#', badge: 'operational' },
    ],
  },
  {
    title: 'Use cases',
    links: [
      { label: 'Teachers · classroom replay', href: '/use-cases' },
      { label: 'Architects · system reviews', href: '/use-cases' },
      { label: 'Product managers · specs', href: '/use-cases' },
      { label: 'Creators · YouTube / Bilibili', href: '/use-cases' },
      { label: 'Compare vs Loom / OBS', href: '/compare' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'FAQ', href: '/#faq' },
      { label: 'Tutorials', href: '/blog' },
      { label: 'Keyboard shortcuts', href: '#' },
      { label: 'Browser support', href: '#' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Refund Policy', href: '/refund' },
      { label: 'Cookie Settings', href: '#' },
      { label: 'Data Processing (DPA)', href: '#' },
    ],
  },
  {
    title: 'Contact',
    links: [
      { label: 'support@excalicast.cn', href: 'mailto:support@excalicast.cn', strong: true },
      { label: 'Contact form', href: '/#contact' },
      { label: 'Twitter / X', href: '#' },
      { label: 'Bilibili', href: '#' },
      { label: 'Discord community', href: '#' },
    ],
  },
];

function FootAnchor({ link }: { link: FLink }): JSX.Element {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: link.strong ? 'var(--foot-text)' : 'var(--foot-dim)',
    fontWeight: link.strong ? 600 : 400,
    textDecoration: 'none',
    fontFamily: link.strong ? 'var(--font-mono)' : 'var(--font-sans)',
    borderBottom: link.strong ? '1.2px solid var(--foot-text)' : 'none',
    paddingBottom: link.strong ? 1 : 0,
  };
  const inner = (
    <>
      {link.label}
      {link.badge && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 6px',
            borderRadius: 999,
            border: '1px solid #7BC98A',
            fontFamily: 'var(--font-mono)',
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#7BC98A',
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: 999, background: '#7BC98A' }} />
          {link.badge}
        </span>
      )}
    </>
  );
  const external = /^(https?:|mailto:|#)/.test(link.href);
  return external ? (
    <a href={link.href} className="footer-link" style={style}>{inner}</a>
  ) : (
    <Link href={link.href} className="footer-link" style={style}>{inner}</Link>
  );
}

export function FooterBar({
  tagline = 'Web-based whiteboard recorder built on Excalidraw. One recording → MP4 + captions + auto outline + handout. Local-first, no install.',
  variant = 'full',
}: {
  tagline?: string;
  variant?: 'full' | 'minimal';
}): JSX.Element {
  if (variant === 'minimal') {
    return (
      <footer
        className="footerbar-craft footerbar-craft-minimal flex flex-col items-start gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-10"
        style={{ width: '100%', background: 'var(--foot-bg)', borderTop: '1.5px solid var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--foot-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        <div className="flex items-center gap-3" style={{ color: 'var(--foot-text)' }}>
          <LogoMark size={18} />
          <span>© 2026 Excalicast · All rights reserved</span>
        </div>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 6, height: 6, borderRadius: 999, background: '#7BC98A' }} />
          All systems normal
        </span>
      </footer>
    );
  }

  return (
    <footer className="footerbar-craft" style={{ width: '100%', background: 'var(--foot-bg)', borderTop: '2px solid var(--ink)', color: 'var(--foot-text)', position: 'relative' }}>
      {/* highlighter keyline seam */}
      <div style={{ position: 'absolute', top: -2, left: 0, right: 0, height: 2, background: 'var(--foot-accent)', opacity: 0.9, pointerEvents: 'none' }} />
      {/* warm dot grid */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(var(--foot-dot) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />

      {/* main grid */}
      <div className="relative grid grid-cols-2 gap-9 px-6 py-12 sm:grid-cols-3 sm:px-10 lg:grid-cols-[1.4fr_repeat(5,1fr)] lg:px-14 lg:py-14">
        {/* brand block */}
        <div className="col-span-2 sm:col-span-3 lg:col-span-1">
          <div className="mb-3.5 flex items-center gap-2.5">
            <div className="footerbar-craft-logo" style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--paper)', border: '1.5px solid var(--ink)', boxShadow: '2px 2px 0 var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
              <LogoMark size={24} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', color: 'var(--foot-text)' }}>Excalicast</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--foot-faint)', letterSpacing: '0.06em', marginTop: 2 }}>excalicast.cc</div>
            </div>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--foot-dim)', margin: '0 0 18px', maxWidth: 280 }}>{tagline}</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="foot-chip">WCAG 2.1 AA</span>
            <span className="foot-chip">GDPR ready</span>
            <span className="foot-chip">Local-first</span>
          </div>
          <div className="footerbar-craft-note tape-wiggle float-tilt mt-5 inline-block" style={{ padding: '6px 12px', background: 'var(--hi)', border: '1.3px solid var(--ink)', fontFamily: 'var(--font-hand)', fontSize: 18, fontWeight: 600, transform: 'rotate(-1.5deg)', boxShadow: '2px 2px 0 var(--ink)', color: 'var(--ink)', ['--tilt' as string]: '-1.5deg', ['--rot' as string]: '-1.5deg' } as CSSProperties}>
            made by humans · in 2026
          </div>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="mb-3.5 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--foot-text)', paddingBottom: 8, borderBottom: '1.4px solid var(--foot-rule)' }}>
              <span style={{ display: 'inline-block', width: 14, height: 4, background: 'var(--foot-accent)', borderRadius: 2 }} />
              {col.title}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 9 }}>
              {col.links.map((l) => (
                <li key={l.label}><FootAnchor link={l} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* bottom strip */}
      <div
        className="relative flex flex-col items-start gap-2 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-14"
        style={{ borderTop: '1.5px solid var(--foot-rule)', background: 'var(--foot-bg-2)', color: 'var(--foot-dim)', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        <span>© 2026 Excalicast · All rights reserved</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Built in 🌏 · Hosted on Vercel</span>
          <span className="hidden sm:inline">·</span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#7BC98A' }} />
            All systems normal
          </span>
        </div>
      </div>
    </footer>
  );
}
