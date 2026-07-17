import type { CSSProperties, JSX } from 'react';
import { I, LogoMark } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getActiveConfig } from '@/lib/paymentConfig';
import { buildAlternates } from '@/lib/seo/alternates';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import { FooterBar } from '@/components/ui';
import { PricingTiers } from './PricingTiers';

interface Props {
  params: Promise<{ locale: string }>;
}

// 价格用 ISR（CDN 缓存，TTFB 快）而非 force-dynamic；改价时 admin 路由 revalidatePath 立即再生。
export const revalidate = 3600;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricingPage.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: buildAlternates('/pricing', locale),
  };
}

export default async function PricingRoute({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const cfg = await getActiveConfig();
  const currency = cfg?.currency ?? 'usd';
  const oneTimeCents = cfg?.oneTimePriceCents ?? 499;
  const proCents = cfg?.proMonthlyPriceCents ?? 999;
  const maxCents = cfg?.maxMonthlyPriceCents ?? 1599;
  const proYearlyCents = cfg?.proYearlyPriceCents ?? 9590;
  const maxYearlyCents = cfg?.maxYearlyPriceCents ?? 15350;
  // 年付切换仅在两档年付 product 都配置好时显示（toPublic 不暴露 product id，只给布尔）。
  const yearlyAvailable = cfg ? !!(cfg.proYearlyProductId && cfg.maxYearlyProductId) : false;
  return (
    <PricingContent
      oneTimeCents={oneTimeCents}
      proCents={proCents}
      maxCents={maxCents}
      proYearlyCents={proYearlyCents}
      maxYearlyCents={maxYearlyCents}
      yearlyAvailable={yearlyAvailable}
      currency={currency}
    />
  );
}

// matrix cell values aligned to pricingPage.matrix.rows.* label arrays
const MATRIX: { cat: string; vals: (boolean | string)[][] }[] = [
  { cat: 'recording', vals: [[true, true, true, true], [true, true, true, true], [true, true, true, true], [true, true, true, true]] },
  { cat: 'export', vals: [[true, '—', '—', '—'], [false, true, true, true], [false, false, true, true], [false, false, true, true]] },
  { cat: 'captions', vals: [[false, false, true, true], [false, false, true, true], [false, false, true, true]] },
  { cat: 'assets', vals: [[false, false, false, true], [false, false, false, true], [false, false, false, true]] },
  { cat: 'sharing', vals: [[true, true, true, true], [false, false, false, true], [false, false, false, true]] },
  { cat: 'templates', vals: [[true, true, true, true], [true, true, true, true], [false, false, true, true]] },
  { cat: 'account', vals: [[true, true, false, false], [false, false, true, true]] },
];

function PricingContent({ oneTimeCents, proCents, maxCents, proYearlyCents, maxYearlyCents, yearlyAvailable, currency }: { oneTimeCents: number; proCents: number; maxCents: number; proYearlyCents: number; maxYearlyCents: number; yearlyAvailable: boolean; currency: string }): JSX.Element {
  const t = useTranslations('pricingPage');
  const tl = useTranslations('landing');
  const th = useTranslations('header');

  return (
    <div className="app-craft-screen pricing-craft-page flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* Header */}
      <header className="pricing-craft-header flex h-16 flex-shrink-0 items-center justify-between px-4 sm:px-10" style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}>
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <LogoMark size={30} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Excalicast</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <Link href="/" className="nav-link" style={navLink(false)}>{tl('footer.home')}</Link>
          <Link href="/library" className="nav-link" style={navLink(false)}>{th('library')}</Link>
          <Link href="/pricing" className="nav-link is-active" style={navLink(true)}>{tl('nav.pricing')}</Link>
        </nav>
        <TrackedLink event="cta_start_recording" eventProps={{ surface: 'nav' }} prefetchKind="whiteboard" href="/app" className="btn-sketch btn-sketch-primary btn-stamp" style={{ padding: '9px 16px' }}>
          <span className="rec-dot" style={{ width: 6, height: 6 }} />
          {tl('nav.startRecording')}
        </TrackedLink>
      </header>

      <main className="flex-1 overflow-auto">
        {/* Hero */}
        <section className="pricing-craft-hero px-6 pb-10 pt-16 text-center sm:px-10 lg:px-20 lg:pt-20">
          <div className="label-mono mb-3.5">{t('kicker')}</div>
          <h1 className="pricing-craft-title mx-auto" style={{ fontSize: 'clamp(32px, 6.5vw, 60px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.05, margin: 0, maxWidth: 880 }}>
            {t('title')} <span className="pricing-craft-title-mark">{t('titleMark')}</span>
          </h1>
          <p className="mx-auto" style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 22, maxWidth: 620 }}>{t('sub')}</p>
        </section>

        {/* Tiers (client island: billing toggle) */}
        <section className="pricing-craft-tier-section px-6 pb-16 sm:px-10 lg:px-20">
          <PricingTiers oneTimeCents={oneTimeCents} proCents={proCents} maxCents={maxCents} proYearlyCents={proYearlyCents} maxYearlyCents={maxYearlyCents} yearlyAvailable={yearlyAvailable} currency={currency} />
        </section>

        {/* Feature matrix */}
        <section className="pricing-craft-matrix-section px-6 py-12 sm:px-10 lg:px-20" style={{ borderTop: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>{t('matrix.heading')}</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 14, marginTop: 8, marginBottom: 24, maxWidth: 720 }}>{t('matrix.note')}</p>
          <FeatureMatrix t={t} tl={tl} />
        </section>

        {/* FAQ */}
        <section className="pricing-craft-faq-section px-6 py-16 sm:px-10 lg:px-20 lg:py-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_2fr] lg:gap-14">
            <div className="lg:sticky lg:top-5 lg:self-start">
              <div className="label-mono mb-2.5">// answers</div>
              <h2 style={{ fontSize: 'clamp(26px, 5vw, 36px)', fontWeight: 700, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.1 }}>{t('faq.heading')}</h2>
              <p style={{ color: 'var(--ink-2)', marginTop: 14, fontSize: 14, lineHeight: 1.6 }}>{t('faq.intro')}</p>
            </div>
            <div className="stagger grid gap-3.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <PricingFaq key={i} q={t(`faq.q${i}.q`)} a={t(`faq.q${i}.a`)} open={i === 1} />
              ))}
            </div>
          </div>
        </section>

        <FooterBar />
      </main>
    </div>
  );
}

function navLink(active: boolean): CSSProperties {
  return { fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink)', opacity: active ? 1 : 0.6, textDecoration: 'none', paddingBottom: 4 };
}

function MatrixCell({ value, isMax }: { value: boolean | string; isMax: boolean }): JSX.Element {
  if (value === true) return <I.Check size={15} sw={2.4} />;
  if (value === false) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, padding: '2px 6px', background: isMax ? 'var(--hi)' : 'var(--paper-2)', border: '1.2px solid var(--ink)', borderRadius: 2 }}>{value}</span>
  );
}

function FeatureMatrix({ t, tl }: { t: ReturnType<typeof useTranslations>; tl: ReturnType<typeof useTranslations> }): JSX.Element {
  const cols = 'grid grid-cols-[1.6fr_repeat(4,1fr)] sm:grid-cols-[2fr_repeat(4,1fr)]';
  return (
    <div className="pricing-craft-matrix" style={{ border: '1.5px solid var(--ink)', borderRadius: 4, overflow: 'hidden', background: 'var(--paper)', boxShadow: '4px 4px 0 var(--ink)' }}>
      {/* header */}
      <div className={`${cols} pricing-craft-matrix-head`} style={{ background: 'var(--ink)', color: 'var(--paper)', padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <span>{t('matrix.feature')}</span>
        <span className="text-center">{tl('pricing.free.label')}</span>
        <span className="text-center">{tl('pricing.oneTime.label')}</span>
        <span className="text-center">{tl('pricing.pro.label')}</span>
        <span className="text-center" style={{ color: 'var(--hi)' }}>{tl('pricing.max.label')} ★</span>
      </div>
      {MATRIX.map((g) => {
        const labels = t.raw(`matrix.rows.${g.cat}`) as string[];
        return (
          <div key={g.cat}>
            <div className="pricing-craft-matrix-group" style={{ padding: '10px 16px', background: 'var(--paper-2)', borderTop: '1.3px solid var(--ink)', borderBottom: '1px solid var(--rule-soft)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--ink-2)' }}>
              {t(`matrix.cats.${g.cat}`)}
            </div>
            {g.vals.map((row, i) => (
              <div key={i} className={`${cols} pricing-craft-matrix-row`} style={{ padding: '10px 16px', borderBottom: i < g.vals.length - 1 ? '1px solid var(--rule-faint)' : 'none', alignItems: 'center', fontSize: 13, background: i % 2 === 0 ? 'var(--paper)' : 'transparent' }}>
                <span>{labels[i]}</span>
                {row.map((v, ci) => (
                  <span key={ci} className="text-center"><MatrixCell value={v} isMax={ci === 3} /></span>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PricingFaq({ q, a, open }: { q: string; a: string; open: boolean }): JSX.Element {
  return (
    <details open={open} className="pricing-craft-faq reveal-up lift" style={{ border: '1.5px solid var(--ink)', borderRadius: 4, padding: '16px 20px', background: open ? 'var(--hi-soft)' : 'var(--paper)', boxShadow: open ? '3px 3px 0 var(--ink)' : 'none' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 600 }}>
        <span>{q}</span>
        <span className="faq-icon" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 3, border: '1.3px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: open ? 'var(--ink)' : 'var(--paper)', color: open ? 'var(--paper)' : 'var(--ink)' }}>
          <I.Plus size={14} sw={2} />
        </span>
      </summary>
      <div data-faq-answer>
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{a}</p>
      </div>
    </details>
  );
}
