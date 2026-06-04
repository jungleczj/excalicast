import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import {
  SketchCard,
  Marker,
  TapeLabel,
  MonoTag,
  CheckRow,
  HeaderBar,
  FooterBar,
} from '@/components/ui';

// Dev-only design-system styleguide. 404 in production; never indexed; not in
// sitemap (sitemap is an explicit allowlist).
export const metadata = { robots: { index: false, follow: false } };

const TOKENS = [
  ['--paper', '#FBFBFA'],
  ['--paper-2', '#F4F3EE'],
  ['--paper-3', '#ECEAE0'],
  ['--ink', '#1A1A1A'],
  ['--ink-2', '#3A3A38'],
  ['--ink-3', '#6B6B66'],
  ['--hi', '#FFD166'],
  ['--hi-soft', '#FFE9B0'],
  ['--rec', '#DC2626'],
  ['--ok', '#2F8A3F'],
  ['--pro', '#B7E0C8'],
  ['--max', '#C9B8FF'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginTop: 40 }}>
      <div className="label-mono" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  );
}

export default async function StyleguidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  if (process.env.NODE_ENV === 'production') notFound();
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HeaderBar
        active="Home"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Library', href: '/library' },
          { label: 'Pricing', href: '/#pricing' },
        ]}
      />
      <main className="flex-1 overflow-auto px-6 py-12 sm:px-10">
        <h1 style={{ fontSize: 'clamp(28px, 6vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
          Design system <Marker>styleguide</Marker>
        </h1>
        <p style={{ marginTop: 12, color: 'var(--ink-2)', maxWidth: 560 }}>
          阶段 0 验证页：tokens / 字体 / 共享原语。dev-only。
        </p>

        <Section title="// color tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {TOKENS.map(([name, hex]) => (
              <div key={name} style={{ border: '1.5px solid var(--ink)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: 48, background: `var(${name})` }} />
                <div style={{ padding: 8, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  <div>{name}</div>
                  <div style={{ color: 'var(--ink-3)' }}>{hex}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="// typography">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em' }}>Geist display 36</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 16 }}>Geist sans 16 — body text the quick brown fox</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '0.06em' }}>JetBrains Mono 13 · METADATA · 00:03:42</div>
            <div style={{ fontFamily: 'var(--font-hand)', fontSize: 26 }}>Caveat hand 26 — canvas-only, no pixels</div>
          </div>
        </Section>

        <Section title="// buttons">
          <div className="flex flex-wrap gap-3">
            <button className="btn-sketch">Default</button>
            <button className="btn-sketch btn-sketch-primary">Primary</button>
            <button className="btn-sketch btn-sketch-hi">Highlighter</button>
          </div>
        </Section>

        <Section title="// mono tags">
          <div className="flex flex-wrap gap-2">
            <MonoTag>default</MonoTag>
            <MonoTag variant="hi">hi</MonoTag>
            <MonoTag variant="rec">● rec</MonoTag>
            <MonoTag variant="pro">pro</MonoTag>
            <MonoTag variant="max">max</MonoTag>
            <MonoTag variant="soft">soft</MonoTag>
          </div>
        </Section>

        <Section title="// sketch cards + tape + checkrow">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <SketchCard style={{ padding: 20 }}>
              <TapeLabel rotate={-3}>canvas-only</TapeLabel>
              <div style={{ marginTop: 12 }}>
                <CheckRow>Operation-stream capture</CheckRow>
                <CheckRow>One take, every ratio</CheckRow>
                <CheckRow on={false}>Screen-pixel recording</CheckRow>
              </div>
            </SketchCard>
            <SketchCard accent style={{ padding: 20 }}>
              <div className="hi-block" style={{ fontFamily: 'var(--font-hand)', fontSize: 18 }}>accent card</div>
              <p style={{ marginTop: 12, color: 'var(--ink-2)', fontSize: 14 }}>5px yellow hard-offset shadow.</p>
            </SketchCard>
            <div className="sketch-frame" style={{ padding: 20 }}>
              <div className="label-mono">sketch-frame</div>
              <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-2)' }}>双层不规则手绘边框。</p>
            </div>
          </div>
        </Section>

        <Section title="// surfaces">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="dots" style={{ height: 90, border: '1.5px solid var(--ink)', borderRadius: 4 }} />
            <div className="dots-fine" style={{ height: 90, border: '1.5px solid var(--ink)', borderRadius: 4 }} />
            <div className="grid-bg" style={{ height: 90, border: '1.5px solid var(--ink)', borderRadius: 4 }} />
          </div>
        </Section>
      </main>
      <FooterBar />
    </div>
  );
}
