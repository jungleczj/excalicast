import type { CSSProperties, JSX, ReactNode } from 'react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { I, LogoMark } from '@/components/icons';
import { DemoButton } from '@/components/landing/DemoButton';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getActiveConfig, formatPrice } from '@/lib/paymentConfig';
import { buildAlternates } from '@/lib/seo/alternates';
import { JsonLd } from '@/components/seo/JsonLd';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import { softwareApplicationSchema, organizationSchema, faqPageSchema } from '@/lib/seo/schema';
import { Marker, MonoTag, SketchCard, CheckRow, TapeLabel, FooterBar, WhiteboardScene } from '@/components/ui';

interface Props {
  params: Promise<{ locale: string }>;
}

// 价格随 payment_config 实时变化：按请求渲染，避免静态预渲染把旧价烤进 HTML。
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: buildAlternates('/', locale),
  };
}

export default async function LandingPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const cfg = await getActiveConfig();
  const oneTimePrice = cfg ? formatPrice(cfg.oneTimePriceCents, cfg.currency) : '$4.99';
  const proPrice = cfg ? formatPrice(cfg.proMonthlyPriceCents, cfg.currency) : '$9.99';
  const maxPrice = cfg ? formatPrice(cfg.maxMonthlyPriceCents, cfg.currency) : '$15.99';

  const t = await getTranslations({ locale, namespace: 'landing' });
  const currency = (cfg?.currency ?? 'usd').toUpperCase();
  const toMajor = (cents: number | undefined, fallback: number) => (cents != null ? cents / 100 : fallback);
  const productSchema = softwareApplicationSchema({
    locale,
    description: t('meta.description'),
    oneTimePrice: toMajor(cfg?.oneTimePriceCents, 4.99),
    proPrice: toMajor(cfg?.proMonthlyPriceCents, 9.99),
    maxPrice: toMajor(cfg?.maxMonthlyPriceCents, 15.99),
    currency,
  });
  const faqSchema = faqPageSchema(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
      question: t(`faq.q${i}.q`),
      answer: t(`faq.q${i}.a`, { price: oneTimePrice }),
    })),
  );

  // 素材就位才渲染对应区块（避免空/坏占位）。用户把 demo.mp4 / shots/editor.png 丢进 public/ 即自动出现。
  const pub = join(process.cwd(), 'public');
  const hasDemo = existsSync(join(pub, 'demo.mp4'));
  const hasShots = existsSync(join(pub, 'shots', 'editor.png'));

  return (
    <>
      <JsonLd data={[productSchema, organizationSchema(), faqSchema]} />
      <LandingContent oneTimePrice={oneTimePrice} proPrice={proPrice} maxPrice={maxPrice} hasDemo={hasDemo} hasShots={hasShots} />
    </>
  );
}

const BRANDS = [
  { name: 'Linear', bg: '#5E6AD2' },
  { name: 'Vercel', bg: '#1A1A1A' },
  { name: 'Notion', bg: '#FFFFFF' },
  { name: 'Cursor', bg: '#1A1A1A' },
  { name: 'Supabase', bg: '#3ECF8E' },
  { name: 'Framer', bg: '#1A1A1A' },
  { name: 'Resend', bg: '#1A1A1A' },
  { name: 'Raycast', bg: '#FF6363' },
  { name: 'Plasmo', bg: '#16161A' },
  { name: 'Loom', bg: '#625DF5' },
];

const ASSETS = [
  { key: 'mp4', Ic: I.Monitor, color: 'var(--hi)' },
  { key: 'srt', Ic: I.Captions, color: 'var(--pro)' },
  { key: 'outline', Ic: I.Sparkles, color: 'var(--max)' },
  { key: 'handout', Ic: I.Doc, color: '#FFD9C8' },
] as const;

const TRUST = [
  { key: 'pricing', Ic: I.Tag, href: '#pricing' },
  { key: 'privacy', Ic: I.Lock, href: '/privacy' },
  { key: 'terms', Ic: I.Doc, href: '/terms' },
  { key: 'refund', Ic: I.Download, href: '/refund' },
  { key: 'contact', Ic: I.Bell, href: '#contact' },
  { key: 'status', Ic: I.Globe, href: '/' },
] as const;

function LandingContent({ oneTimePrice, proPrice, maxPrice, hasDemo, hasShots }: { oneTimePrice: string; proPrice: string; maxPrice: string; hasDemo: boolean; hasShots: boolean }): JSX.Element {
  const t = useTranslations('landing');
  const th = useTranslations('header');

  const tiers = [
    { tier: 'free' as const, name: t('pricing.free.label'), price: '$0', tk: 'pricingTeaser.free', bg: 'var(--paper)', primary: false },
    { tier: 'one_time' as const, name: t('pricing.oneTime.label'), price: oneTimePrice, tk: 'pricingTeaser.oneTime', bg: 'var(--paper)', primary: false },
    { tier: 'pro' as const, name: t('pricing.pro.label'), price: proPrice, tk: 'pricingTeaser.pro', bg: 'var(--pro)', primary: false },
    { tier: 'max' as const, name: t('pricing.max.label'), price: maxPrice, tk: 'pricingTeaser.max', bg: 'var(--max)', primary: true },
  ];

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* ─── Header ─── */}
      <header className="flex h-16 flex-shrink-0 items-center justify-between px-4 sm:px-10" style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}>
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
          <LogoMark size={30} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Excalicast</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <Link href="/" className="nav-link is-active" style={navLink(true)}>{t('footer.home')}</Link>
          <Link href="/library" className="nav-link" style={navLink(false)}>{th('library')}</Link>
          <Link href="/pricing" className="nav-link" style={navLink(false)}>{t('nav.pricing')}</Link>
        </nav>
        <div className="flex items-center gap-3">
          <TrackedLink event="cta_start_recording" eventProps={{ surface: 'nav' }} prefetchKind="whiteboard" href="/app" className="btn-sketch btn-sketch-primary btn-stamp" style={{ padding: '9px 16px' }}>
            <span className="rec-dot" style={{ width: 6, height: 6 }} />
            {t('nav.startRecording')}
          </TrackedLink>
          <div className="hidden sm:flex" style={{ width: 34, height: 34, border: '1.5px solid var(--ink)', borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
            <I.User size={16} />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {/* ─── HERO ─── */}
        <section className="grid grid-cols-1 items-center gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:px-20 lg:pb-24 lg:pt-20">
          <div className="stagger">
            <div className="reveal-up mb-7 flex flex-wrap items-center gap-2">
              <MonoTag variant="rec">● v0.3 BETA</MonoTag>
              <MonoTag variant="soft">POWERED BY EXCALIDRAW</MonoTag>
            </div>
            <h1 className="reveal-up" style={{ fontSize: 'clamp(34px, 7.2vw, 64px)', fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.035em', margin: 0 }}>
              {t('hero.titleLine1')}<br />
              {t('hero.titleLine2')}<br />
              <span style={{ display: 'inline-block', marginTop: 8 }}><Marker>{t('hero.marker')}</Marker></span>
            </h1>
            <p className="reveal-up" style={{ marginTop: 28, fontSize: 18, lineHeight: 1.55, color: 'var(--ink-2)', maxWidth: 520 }}>{t('hero.subtitle')}</p>
            <div className="reveal-up mt-9 flex flex-wrap items-center gap-3.5">
              <TrackedLink event="cta_start_recording" eventProps={{ surface: 'hero' }} prefetchKind="whiteboard" href="/app" className="btn-sketch btn-sketch-primary btn-stamp lift">
                <span className="rec-dot" style={{ width: 7, height: 7 }} />
                {t('hero.ctaPrimary')}
              </TrackedLink>
              <a href="#pricing" className="btn-sketch btn-stamp lift">{t('hero.ctaSecondary')}</a>
              {hasDemo && <DemoButton label={t('hero.viewDemo')} closeLabel={t('hero.demoClose')} />}
            </div>
            <div className="reveal-up mt-6 flex flex-wrap items-center gap-x-5 gap-y-2" style={{ fontSize: 13, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> {t('hero.chipNoDownload')}</span>
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> {t('hero.chipNoSignup')}</span>
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> {t('hero.chipLocalFirst')}</span>
            </div>
          </div>
          <HeroMock />
        </section>

        {/* ─── SOCIAL PROOF MARQUEE ─── */}
        <section className="flex items-center overflow-hidden" style={{ borderTop: '1.5px solid var(--ink)', borderBottom: '1.5px solid var(--ink)', padding: '18px 0', background: 'var(--paper-2)' }}>
          <span className="hidden flex-shrink-0 sm:block" style={{ color: 'var(--ink)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 32px 0 80px' }}>
            {t('socialProof')}
          </span>
          <div className="marquee" style={{ flex: 1, ['--marq-dur' as string]: '34s' } as CSSProperties}>
            <MarqTrack />
            <MarqTrack ariaHidden />
          </div>
        </section>

        {/* ─── FOUR ASSETS ─── */}
        <section className="px-6 pb-16 pt-20 sm:px-10 lg:px-20 lg:pb-16 lg:pt-24">
          <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div style={{ maxWidth: 600 }}>
              <div className="label-mono mb-3">// the core promise</div>
              <h2 style={{ fontSize: 'clamp(28px, 5vw, 40px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>
                {t('assets.heading1')}<br />
                <span className="underline-draw">{t('assets.heading2')}</span>
              </h2>
            </div>
            <p style={{ maxWidth: 380, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>{t('assets.sub')}</p>
          </div>
          <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ASSETS.map(({ key, Ic, color }) => (
              <div key={key} className="reveal-pop">
                <SketchCard style={{ padding: 24, minHeight: 272 }}>
                  <div style={{ width: 42, height: 42, border: '1.5px solid var(--ink)', background: color, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, boxShadow: '2px 2px 0 var(--ink)' }}>
                    <Ic size={22} sw={1.6} />
                  </div>
                  <div className="label-mono" style={{ marginBottom: 10 }}>{t(`assets.${key}.tag`)}</div>
                  <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.015em' }}>{t(`assets.${key}.title`)}</div>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{t(`assets.${key}.body`)}</p>
                </SketchCard>
              </div>
            ))}
          </div>
        </section>

        {/* ─── INSIDE THE EDITOR (real screenshot, only when asset exists) ─── */}
        {hasShots && (
          <section className="px-6 pb-4 pt-8 sm:px-10 lg:px-20">
            <div className="mb-8 text-center">
              <div className="label-mono mb-3">{t('shots.kicker')}</div>
              <h2 style={{ fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>{t('shots.heading')}</h2>
              <p className="mx-auto" style={{ maxWidth: 560, marginTop: 12, fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55 }}>{t('shots.sub')}</p>
            </div>
            <div className="reveal-pop mx-auto" style={{ maxWidth: 1040, border: '2px solid var(--ink)', borderRadius: 8, boxShadow: '6px 6px 0 var(--ink)', overflow: 'hidden', background: 'var(--paper)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/shots/editor.png" alt={t('shots.alt')} style={{ display: 'block', width: '100%', height: 'auto' }} />
            </div>
          </section>
        )}

        {/* ─── DIFFERENTIATOR ─── */}
        <section className="grid grid-cols-1 items-center gap-12 px-6 py-16 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:px-20">
          <div className="reveal-left">
            <MonoTag variant="hi">{t('isolation.tag')}</MonoTag>
            <h2 style={{ marginTop: 16, fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('isolation.heading')}</h2>
            <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 16, maxWidth: 500 }}>{t('isolation.body')}</p>
            <div style={{ marginTop: 24 }}>
              <CheckRow>{t('isolation.check1')}</CheckRow>
              <CheckRow>{t('isolation.check2')}</CheckRow>
              <CheckRow>{t('isolation.check3')}</CheckRow>
              <CheckRow>{t('isolation.check4')}</CheckRow>
            </div>
          </div>
          <div className="reveal-right" style={{ background: 'var(--paper-2)', border: '1.5px solid var(--ink)', borderRadius: 4, padding: 24, boxShadow: '4px 4px 0 var(--ink)', position: 'relative' }}>
            <div className="label-mono" style={{ marginBottom: 14, color: 'var(--ink-3)' }}>// before vs after</div>
            <div style={{ border: '1.5px dashed var(--rec)', padding: 14, borderRadius: 4, marginBottom: 14, background: 'rgba(220,38,38,0.04)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rec)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('isolation.beforeLabel')}</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 18 }}>{t('isolation.beforeText')}</div>
            </div>
            <div style={{ border: '1.5px solid var(--ink)', background: 'var(--hi-soft)', padding: 14, borderRadius: 4 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('isolation.afterLabel')}</div>
              <div style={{ fontFamily: 'var(--font-hand)', fontSize: 18 }}>{t('isolation.afterText')}</div>
            </div>
            <div style={{ position: 'absolute', top: -12, right: 24 }}><TapeLabel rotate={4}>{t('isolation.tape')}</TapeLabel></div>
          </div>
        </section>

        {/* ─── PRICING TEASER ─── */}
        <section id="pricing" className="px-6 py-16 sm:px-10 lg:px-20 lg:pb-24" style={{ borderTop: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 style={{ fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>{t('pricingTeaser.heading')}</h2>
            <p style={{ maxWidth: 380, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{t('pricingTeaser.sub')}</p>
          </div>
          <div className="stagger mx-auto grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" style={{ maxWidth: 1240 }}>
            {tiers.map((p) => (
              <div key={p.tier} className="reveal-up">
                <SketchCard style={{ padding: 22, position: 'relative', background: p.bg }}>
                  {p.primary && (
                    <div style={{ position: 'absolute', top: -14, right: 16 }}>
                      <TapeLabel rotate={5} color="var(--ink)" style={{ color: 'var(--paper)' }}>{t('pricingTeaser.max.popular')}</TapeLabel>
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ marginTop: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>{p.price}</span>
                    <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--ink-2)' }}>{t(`${p.tk}.unit`)}</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, minHeight: 60, margin: 0 }}>{t(`${p.tk}.body`)}</p>
                  <TrackedLink event="pricing_cta_click" eventProps={{ tier: p.tier }} href="/app" className={'btn-sketch btn-stamp w-full' + (p.primary ? ' btn-sketch-primary' : '')} style={{ marginTop: 16, justifyContent: 'center' }}>
                    {t(`${p.tk}.cta`)} <I.ArrowRight size={14} />
                  </TrackedLink>
                </SketchCard>
              </div>
            ))}
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section id="faq" className="px-6 py-16 sm:px-10 lg:px-20 lg:py-24" style={{ borderTop: '1.5px solid var(--ink)' }}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-14">
            <div className="lg:sticky lg:top-5 lg:self-start">
              <div className="label-mono mb-3">// frequently asked</div>
              <h2 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>{t('faq.heading')}</h2>
              <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 16, marginBottom: 22 }}>{t('faq.intro')}</p>
              <a href="mailto:support@excalicast.cn" className="btn-sketch lift"><I.Bell size={13} /> {t('faq.emailCta')}</a>
            </div>
            <div className="stagger grid gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                <Faq key={i} i={i} t={t} oneTimePrice={oneTimePrice} />
              ))}
            </div>
          </div>
        </section>

        {/* ─── TRUST / HELP ─── */}
        <section id="contact" className="px-6 py-16 sm:px-10 lg:px-20 lg:pb-24" style={{ background: 'var(--paper-2)', borderTop: '1.5px solid var(--ink)' }}>
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="label-mono mb-3">// trust &amp; help</div>
              <h2 style={{ fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>{t('trust.heading')}</h2>
            </div>
            <p style={{ maxWidth: 380, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>{t('trust.sub')}</p>
          </div>
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(({ key, Ic, href }, idx) => (
              <TrustCard key={key} href={href} Ic={Ic} title={t(`trust.${key}.title`)} desc={t(`trust.${key}.desc`)} tag={t(`trust.${key}.tag`)} highlight={idx === 0} />
            ))}
          </div>
          <div className="mt-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between" style={{ padding: '20px 24px', background: 'var(--ink)', color: 'var(--paper)', borderRadius: 4 }}>
            <div className="flex items-center gap-4">
              <div style={{ width: 44, height: 44, borderRadius: 4, background: 'var(--hi)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', flexShrink: 0 }}>
                <I.Bell size={20} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--hi)', textTransform: 'uppercase', marginBottom: 4 }}>{t('trust.calloutKicker')}</div>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('trust.calloutTitle')}</div>
              </div>
            </div>
            <a href="mailto:support@excalicast.cn" className="btn-sketch btn-sketch-hi btn-stamp" style={{ flexShrink: 0 }}>
              <I.ArrowRight size={13} /> support@excalicast.cn
            </a>
          </div>
        </section>

        <FooterBar />
      </main>
    </div>
  );
}

function navLink(active: boolean): CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--ink)',
    opacity: active ? 1 : 0.6,
    textDecoration: 'none',
    paddingBottom: 4,
  };
}

/** One marquee track of brand chips (rendered twice for a seamless loop). */
function MarqTrack({ ariaHidden = false }: { ariaHidden?: boolean }): JSX.Element {
  return (
    <div className="__marq-track" aria-hidden={ariaHidden || undefined}>
      {BRANDS.map((b) => {
        const dark = b.bg === '#1A1A1A' || b.bg === '#16161A';
        const light = b.bg === '#FFFFFF';
        const fg = light ? '#1A1A1A' : '#FFFFFF';
        return (
          <span key={b.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 11, flexShrink: 0 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: b.bg, border: '1.4px solid var(--ink)', boxShadow: '1.5px 1.5px 0 var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: fg, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, lineHeight: 1, opacity: dark ? 0.95 : 1 }}>
              {b.name[0]}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink)' }}>{b.name}</span>
          </span>
        );
      })}
    </div>
  );
}

function Faq({ i, t, oneTimePrice }: { i: number; t: ReturnType<typeof useTranslations>; oneTimePrice: string }): JSX.Element {
  const k = `faq.q${i}`;
  const href = t.has(`${k}.href`) ? t(`${k}.href`) : null;
  const first = i === 1;
  return (
    <details open={first} className="reveal-up lift" style={{ border: '1.5px solid var(--ink)', borderRadius: 4, padding: '18px 22px', background: first ? 'var(--hi-soft)' : 'var(--paper)', boxShadow: first ? '3px 3px 0 var(--ink)' : 'none' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <MonoTag variant="soft">{t(`${k}.tag`)}</MonoTag>
          <h3 style={{ fontSize: 15.5, fontWeight: 600, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.4 }}>{t(`${k}.q`)}</h3>
        </span>
        <span className="faq-icon" style={{ width: 28, height: 28, borderRadius: 3, border: '1.3px solid var(--ink)', background: first ? 'var(--ink)' : 'var(--paper)', color: first ? 'var(--paper)' : 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <I.Plus size={14} sw={2} />
        </span>
      </summary>
      <div data-faq-answer style={{ marginTop: 14 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--ink-2)' }}>{t(`${k}.a`, { price: oneTimePrice })}</p>
        {href && <FaqLink href={href} label={t('faq.readFull')} />}
      </div>
    </details>
  );
}

function FaqLink({ href, label }: { href: string; label: string }): JSX.Element {
  const style: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink)', textDecoration: 'none', borderBottom: '1.4px solid var(--ink)', paddingBottom: 2 };
  const inner = (<>{label} <I.ArrowRight size={11} /></>);
  return href.startsWith('#') ? <a href={href} style={style}>{inner}</a> : <Link href={href} style={style}>{inner}</Link>;
}

function TrustCard({ href, Ic, title, desc, tag, highlight }: { href: string; Ic: typeof I.Tag; title: string; desc: string; tag: string; highlight: boolean }): JSX.Element {
  const body: ReactNode = (
    <>
      <div className="mb-3.5 flex items-start justify-between">
        <div style={{ width: 40, height: 40, borderRadius: 3, border: '1.4px solid var(--ink)', background: highlight ? 'var(--hi)' : 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '2px 2px 0 var(--ink)' }}>
          <Ic size={18} />
        </div>
        <MonoTag variant="soft">{tag}</MonoTag>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{desc}</p>
      <div className="mt-4 flex items-center gap-1.5" style={{ paddingTop: 12, borderTop: '1px dashed var(--rule-soft)', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        View page <I.ArrowRight size={11} />
      </div>
    </>
  );
  const cardStyle: CSSProperties = { display: 'block', padding: 22, background: 'var(--paper)', border: '1.5px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)', textDecoration: 'none', color: 'var(--ink)' };
  return href.startsWith('#') ? (
    <a href={href} className="reveal-up lift" style={cardStyle}>{body}</a>
  ) : (
    <Link href={href} className="reveal-up lift" style={cardStyle}>{body}</Link>
  );
}

/** Hero recorder mock — viewfinder frame + glow + parallax + corner brackets + WhiteboardScene. */
function HeroMock(): JSX.Element {
  return (
    <div className="reveal-pop parallax-host" style={{ position: 'relative' }}>
      {/* soft glow */}
      <div data-parallax="-14,-10" style={{ position: 'absolute', top: -30, right: -30, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, var(--hi-soft) 0%, transparent 70%)', opacity: 0.7, filter: 'blur(20px)' }} />
      {/* dashed viewfinder frame */}
      <div data-parallax="6,4" style={{ position: 'relative', padding: 18, border: '2px dashed var(--ink)', borderRadius: 6, background: 'var(--paper)' }}>
        {/* browser chrome */}
        <div style={{ borderTopLeftRadius: 4, borderTopRightRadius: 4, background: 'var(--paper-2)', border: '1.5px solid var(--ink)', borderBottom: 'none', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="flex gap-1.5">
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
              <div key={c} className="dot-pulse" style={{ width: 11, height: 11, borderRadius: 999, background: c, border: '1.2px solid var(--ink)' }} />
            ))}
          </div>
          <div className="flex-1 text-center" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)' }}>rec_session_001.mp4</div>
          <span className="rec-dot" style={{ width: 9, height: 9 }} />
        </div>
        {/* canvas */}
        <div className="dots scan-sweep" style={{ border: '1.5px solid var(--ink)', background: 'var(--paper)', height: 360, position: 'relative', overflow: 'hidden' }}>
          <WhiteboardScene animate />
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', background: 'var(--ink)', color: 'white', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
            <span className="rec-dot" style={{ width: 7, height: 7 }} /> REC 00:03:42
          </div>
          <div style={{ position: 'absolute', bottom: 16, right: 16, width: 84, height: 84, borderRadius: '50%', border: '2px solid var(--ink)', background: 'linear-gradient(135deg, #FFE0B2 0%, #FFB870 100%)', boxShadow: '3px 3px 0 var(--ink)', overflow: 'hidden' }}>
            <svg viewBox="0 0 100 100">
              <ellipse cx="50" cy="105" rx="45" ry="30" fill="#1e3a8a" />
              <circle cx="50" cy="55" r="22" fill="#fcd9b6" />
              <path d="M28 50 Q30 35 50 32 Q70 35 72 50 Q68 42 50 42 Q32 42 28 50" fill="#3f2e1e" />
              <path d="M42 62 Q50 68 58 62" stroke="#7c2d12" strokeWidth="1.5" fill="none" />
              <circle cx="42" cy="55" r="1.5" fill="#1f2937" />
              <circle cx="58" cy="55" r="1.5" fill="#1f2937" />
            </svg>
          </div>
          <div className="float-tilt" style={{ position: 'absolute', top: 50, right: 70, background: 'var(--hi)', border: '1.4px solid var(--ink)', padding: '6px 12px', fontFamily: 'var(--font-hand)', fontWeight: 600, fontSize: 17, transform: 'rotate(3deg)', boxShadow: '2px 2px 0 var(--ink)', ['--tilt' as string]: '3deg' } as CSSProperties}>
            ← cache layer
          </div>
        </div>
        {/* mock toolbar */}
        <div style={{ borderBottomLeftRadius: 4, borderBottomRightRadius: 4, background: 'var(--paper)', border: '1.5px solid var(--ink)', borderTop: 'none', padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {[I.Hand, I.Pencil, I.Square, I.Diamond, I.Arrow, I.Text, I.Highlighter].map((Ic, i) => (
            <div key={i} style={{ width: 34, height: 34, border: '1.3px solid var(--ink)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 1 ? 'var(--hi)' : 'var(--paper)' }}>
              <Ic size={16} />
            </div>
          ))}
        </div>
      </div>
      {/* corner viewfinder brackets (draw-in) */}
      <div className="brackets-draw" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[
          { pos: { top: -8, left: -8 }, path: 'M 0 14 L 0 0 L 14 0', flip: undefined as string | undefined },
          { pos: { top: -8, right: -8 }, path: 'M 14 14 L 14 0 L 0 0', flip: 'scaleX(-1)' },
          { pos: { bottom: -8, left: -8 }, path: 'M 0 0 L 0 14 L 14 14', flip: undefined },
          { pos: { bottom: -8, right: -8 }, path: 'M 14 0 L 14 14 L 0 14', flip: 'scaleX(-1)' },
        ].map((c, i) => (
          <svg key={i} width="20" height="20" style={{ position: 'absolute', ...c.pos, transform: c.flip }}>
            <path d={c.path} stroke="var(--ink)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        ))}
      </div>
    </div>
  );
}
