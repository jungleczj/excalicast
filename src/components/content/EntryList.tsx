import type { JSX } from 'react';
import { Link } from '@/i18n/navigation';

/** Reusable card list for content hub pages (compare / use-cases / blog). */
export function EntryList({
  items,
}: {
  items: { href: string; title: string; description: string; meta?: string }[];
}): JSX.Element {
  return (
    <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="block"
          style={{
            border: '2px solid var(--ink)',
            borderRadius: 12,
            padding: '18px 20px',
            boxShadow: '3px 3px 0 0 var(--ink)',
            textDecoration: 'none',
            color: 'var(--ink)',
            background: 'var(--paper)',
          }}
        >
          {it.meta && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
              {it.meta}
            </div>
          )}
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>{it.title}</div>
          <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {it.description}
          </div>
        </Link>
      ))}
    </div>
  );
}
