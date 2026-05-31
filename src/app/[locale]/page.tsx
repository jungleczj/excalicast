import { I, LogoMark } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getActiveConfig, formatPrice } from '@/lib/paymentConfig';

interface Props {
  params: Promise<{ locale: string }>;
}

// 价格随 payment_config 实时变化：按请求渲染，避免静态预渲染把旧价烤进 HTML。
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.meta' });
  return { title: t('title'), description: t('description') };
}

export default async function LandingPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const cfg = await getActiveConfig();
  const oneTimePrice = cfg ? formatPrice(cfg.oneTimePriceCents, cfg.currency) : '$4.99';
  const proPrice = cfg ? formatPrice(cfg.proMonthlyPriceCents, cfg.currency) : '$9.99';
  const maxPrice = cfg ? formatPrice(cfg.maxMonthlyPriceCents, cfg.currency) : '$15.99';
  const provider = cfg?.provider ?? 'creem';
  return <LandingContent oneTimePrice={oneTimePrice} proPrice={proPrice} maxPrice={maxPrice} provider={provider} />;
}

function LandingContent({ oneTimePrice, proPrice, maxPrice, provider }: { oneTimePrice: string; proPrice: string; maxPrice: string; provider: 'creem' | 'paddle' }): JSX.Element {
  const t = useTranslations('landing');
  // 支付商文案随 active provider 动态显示（避免写死 Paddle）。
  const providerLabel = provider === 'creem' ? 'Creem' : 'Paddle';
  const providerUrl = provider === 'creem' ? 'https://www.creem.io' : 'https://www.paddle.com';
  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* ─── Header ─── */}
      <header
        className="flex h-16 flex-shrink-0 items-center justify-between px-10"
        style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Excalicast
          </span>
        </Link>
        <nav className="flex items-center gap-8">
          {['Home', 'Pricing', 'Contact'].map((item, i) => (
            <a
              key={item}
              href={item === 'Pricing' ? '#pricing' : item === 'Contact' ? '#contact' : '#'}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--ink)',
                opacity: i === 0 ? 1 : 0.55,
                textDecoration: 'none',
                paddingBottom: 4,
                borderBottom: i === 0 ? '2px solid var(--ink)' : '2px solid transparent',
              }}
            >
              {item === 'Home' ? t('footer.home') : item === 'Pricing' ? t('nav.pricing') : t('nav.contact')}
            </a>
          ))}
        </nav>
        <Link href="/app" className="btn-sketch btn-sketch-primary" style={{ padding: '10px 18px' }}>
          <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
          {t('nav.startRecording')}
        </Link>
      </header>

      <main className="flex-1 overflow-auto">
        {/* ─── HERO ─── */}
        <section
          className="grid gap-14 px-20 py-20"
          style={{ gridTemplateColumns: '1.05fr 1fr', alignItems: 'center' }}
        >
          <div>
            <div className="mb-7 flex items-center gap-2">
              <span className="tag-mono tag-mono-rec">● v0.3 BETA</span>
              <span className="tag-mono tag-mono-soft">POWERED BY EXCALIDRAW</span>
            </div>
            <h1
              style={{
                fontSize: 60,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: '-0.035em',
                margin: 0,
              }}
            >
              {t('hero.titleLine1')}<br />
              <span style={{ position: 'relative', display: 'inline-block', marginTop: 4 }}>
                <span className="marker">{t('hero.titleLine2')}</span>
              </span>
            </h1>
            <p style={{ marginTop: 26, fontSize: 17, lineHeight: 1.55, color: 'var(--ink-2)', maxWidth: 520 }}>
              {t('hero.subtitle')}
            </p>

            <div className="mt-9 flex items-center gap-3">
              <Link href="/app" className="btn-sketch btn-sketch-primary">
                <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
                {t('hero.ctaPrimary')}
              </Link>
              <a href="#pricing" className="btn-sketch">{t('hero.ctaSecondary')}</a>
            </div>

            <div
              className="mt-6 flex items-center gap-5"
              style={{ fontSize: 13, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
            >
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> No download</span>
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> No sign-up</span>
              <span className="flex items-center gap-1.5"><I.Check size={14} sw={2.2} /> Local-first</span>
            </div>
          </div>

          {/* Hero recorder mock */}
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'relative',
                padding: 18,
                border: '2px dashed var(--ink)',
                borderRadius: 6,
                background: 'var(--paper)',
              }}
            >
              {/* Browser chrome */}
              <div
                style={{
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                  background: 'var(--paper-2)',
                  border: '1.5px solid var(--ink)',
                  borderBottom: 'none',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div className="flex gap-1.5">
                  {['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => (
                    <div
                      key={i}
                      style={{ width: 11, height: 11, borderRadius: 999, background: c, border: '1.2px solid var(--ink)' }}
                    />
                  ))}
                </div>
                <div className="flex-1 text-center" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)' }}>
                  rec_session_001.mp4
                </div>
                <span className="recording-indicator h-2 w-2 rounded-full" style={{ background: 'var(--rec)' }} />
              </div>

              {/* Canvas mock */}
              <div
                className="dots-bg"
                style={{
                  border: '1.5px solid var(--ink)',
                  background: 'var(--paper)',
                  height: 320,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* sample sketches */}
                <svg viewBox="0 0 400 300" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <rect x="40" y="60" width="120" height="60" rx="4" fill="#FFF8E0" stroke="#1A1A1A" strokeWidth="1.5" />
                  <rect x="220" y="60" width="120" height="60" rx="4" fill="#FBF8FF" stroke="#1A1A1A" strokeWidth="1.5" />
                  <rect x="130" y="180" width="120" height="60" rx="4" fill="#E6F3EA" stroke="#1A1A1A" strokeWidth="1.5" />
                  <path d="M160 90 Q190 90 220 90" stroke="#1A1A1A" strokeWidth="1.5" fill="none" markerEnd="url(#arrowhead)" />
                  <defs>
                    <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                      <path d="M0 0 L8 4 L0 8 z" fill="#1A1A1A" />
                    </marker>
                  </defs>
                  <text x="100" y="95" textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#1A1A1A">Client</text>
                  <text x="280" y="95" textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#1A1A1A">API</text>
                  <text x="190" y="215" textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#1A1A1A">DB</text>
                </svg>

                {/* REC chip */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 10px',
                    background: 'var(--ink)',
                    color: 'white',
                    borderRadius: 999,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                  }}
                >
                  <span className="recording-indicator h-1.5 w-1.5 rounded-full" style={{ background: 'var(--rec)' }} />
                  REC 00:03:42
                </div>

                {/* Camera bubble */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 14,
                    right: 14,
                    width: 78,
                    height: 78,
                    borderRadius: '50%',
                    border: '2px solid var(--ink)',
                    background: 'linear-gradient(135deg, #FFE0B2 0%, #FFB870 100%)',
                    boxShadow: '3px 3px 0 var(--ink)',
                    overflow: 'hidden',
                  }}
                >
                  <svg viewBox="0 0 100 100">
                    <ellipse cx="50" cy="105" rx="45" ry="30" fill="#1e3a8a" />
                    <circle cx="50" cy="55" r="22" fill="#fcd9b6" />
                    <path d="M28 50 Q30 35 50 32 Q70 35 72 50 Q68 42 50 42 Q32 42 28 50" fill="#3f2e1e" />
                    <circle cx="42" cy="55" r="1.5" fill="#1f2937" />
                    <circle cx="58" cy="55" r="1.5" fill="#1f2937" />
                  </svg>
                </div>

                {/* Hand-drawn callout */}
                <div
                  style={{
                    position: 'absolute',
                    top: 38,
                    right: 60,
                    background: 'var(--hi)',
                    border: '1.4px solid var(--ink)',
                    padding: '5px 11px',
                    fontFamily: 'var(--font-hand)',
                    fontWeight: 600,
                    fontSize: 16,
                    transform: 'rotate(3deg)',
                    boxShadow: '2px 2px 0 var(--ink)',
                  }}
                >
                  ← cache layer
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 4 ASSETS ─── */}
        <section className="px-20 pb-16 pt-8">
          <div className="mb-12 flex items-end justify-between">
            <div style={{ maxWidth: 600 }}>
              <div className="label-mono mb-3">// the core promise</div>
              <h2 style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>
                {t('features.heading')}
              </h2>
            </div>
            <p style={{ maxWidth: 380, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
              Built on a fixed grid with intentional imperfections — a tactical, editorial feel for daily teaching workflow.
            </p>
          </div>

          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <FeatureCard tag="01" Icon={I.Edit} color="var(--hi)" title={t('features.lossless.title')} desc={t('features.lossless.desc')} />
            <FeatureCard tag="02" Icon={I.Mic} color="var(--pro)" title={t('features.audio.title')} desc={t('features.audio.desc')} />
            <FeatureCard tag="03" Icon={I.Crop} color="var(--max)" title={t('features.ratios.title')} desc={t('features.ratios.desc')} />
            <FeatureCard tag="04" Icon={I.Download} color="#FFD9C8" title={t('features.local.title')} desc={t('features.local.desc')} />
            <FeatureCard tag="05" Icon={I.Camera} color="var(--hi-soft)" title={t('features.camera.title')} desc={t('features.camera.desc')} />
            <FeatureCard tag="06" Icon={I.Lock} color="var(--paper-3)" title={t('features.privacy.title')} desc={t('features.privacy.desc')} />
          </div>
        </section>

        {/* ─── PRICING ─── */}
        <section id="pricing" className="px-20 py-16" style={{ borderTop: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div className="mb-12 text-center">
            <div className="label-mono mb-3">// pricing</div>
            <h2 style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>
              {t('pricing.heading')}.{' '}
              <span className="marker">Simple.</span>
            </h2>
            <p
              className="mx-auto mt-4"
              style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 580 }}
            >
              {t('pricing.subheading')}
            </p>
          </div>

          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(4, 1fr)', maxWidth: 1240, margin: '0 auto' }}>
            {/* Free tier */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                background: 'var(--paper)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '3px 3px 0 var(--ink)',
                padding: 28,
              }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {t('pricing.free.label')}
              </div>
              <div className="mt-3 mb-3 flex items-baseline">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em' }}>$0</span>
                <span className="ml-2" style={{ fontSize: 13, color: 'var(--ink-2)' }}>forever</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                {t('pricing.free.tagline')}
              </p>

              <ul className="space-y-2" style={{ marginBottom: 24, flexGrow: 1 }}>
                <Bullet>{t('pricing.free.bullet1')}</Bullet>
                <Bullet>{t('pricing.free.bullet2')}</Bullet>
                <Bullet>{t('pricing.free.bullet3')}</Bullet>
                <Bullet>{t('pricing.free.bullet4')}</Bullet>
                <Bullet>{t('pricing.free.bullet5')}</Bullet>
              </ul>

              <Link href="/app" className="btn-sketch w-full" style={{ justifyContent: 'center' }}>
                {t('pricing.free.cta')}
              </Link>
            </div>

            {/* One-time tier */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                background: 'var(--hi)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '3px 3px 0 var(--ink)',
                padding: 28,
              }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {t('pricing.oneTime.label')}
              </div>
              <div className="mt-3 mb-3 flex items-baseline">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em' }}>
                  {oneTimePrice}
                </span>
                <span className="ml-2" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t('pricing.oneTime.unit')}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                {t('pricing.oneTime.tagline')}
              </p>

              <ul className="space-y-2" style={{ marginBottom: 24, flexGrow: 1 }}>
                <Bullet>{t('pricing.oneTime.bullet1')}</Bullet>
                <Bullet>{t('pricing.oneTime.bullet2')}</Bullet>
                <Bullet>{t('pricing.oneTime.bullet3')}</Bullet>
                <Bullet>{t('pricing.oneTime.bullet4', { provider: providerLabel })}</Bullet>
                <Bullet>{t('pricing.oneTime.bullet5')}</Bullet>
              </ul>

              <Link href="/app" className="btn-sketch btn-sketch-primary w-full" style={{ justifyContent: 'center' }}>
                {t('pricing.oneTime.cta')}
              </Link>
            </div>

            {/* Pro tier — 推荐 */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                background: 'var(--pro)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '6px 6px 0 var(--ink)',
                padding: 28,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -14,
                  right: 18,
                  padding: '5px 12px',
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: '1.4px solid var(--ink)',
                  fontFamily: 'var(--font-hand)',
                  fontWeight: 600,
                  fontSize: 15,
                  transform: 'rotate(5deg)',
                  boxShadow: '2px 2px 0 0 rgba(0,0,0,0.12)',
                  borderRadius: 2,
                }}
              >
                ★ {t('pricing.pro.recommended')}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {t('pricing.pro.label')}
              </div>
              <div className="mt-3 mb-3 flex items-baseline">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em' }}>
                  {proPrice}
                </span>
                <span className="ml-2" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t('pricing.pro.unit')}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                {t('pricing.pro.tagline')}
              </p>

              <ul className="space-y-2" style={{ marginBottom: 24, flexGrow: 1 }}>
                <Bullet>{t('pricing.pro.bullet1')}</Bullet>
                <Bullet>{t('pricing.pro.bullet2')}</Bullet>
                <Bullet>{t('pricing.pro.bullet3')}</Bullet>
                <Bullet>{t('pricing.pro.bullet4')}</Bullet>
                <Bullet>{t('pricing.pro.bullet5')}</Bullet>
                <Bullet>{t('pricing.pro.bullet6')}</Bullet>
              </ul>

              <Link href="/app" className="btn-sketch w-full" style={{ justifyContent: 'center' }}>
                {t('pricing.pro.cta')}
              </Link>
            </div>

            {/* Max tier */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                background: 'var(--max)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '3px 3px 0 var(--ink)',
                padding: 28,
              }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {t('pricing.max.label')}
              </div>
              <div className="mt-3 mb-3 flex items-baseline">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em' }}>
                  {maxPrice}
                </span>
                <span className="ml-2" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{t('pricing.max.unit')}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
                {t('pricing.max.tagline')}
              </p>

              <ul className="space-y-2" style={{ marginBottom: 24, flexGrow: 1 }}>
                <Bullet>{t('pricing.max.bullet1')}</Bullet>
                <Bullet>{t('pricing.max.bullet2')}</Bullet>
                <Bullet>{t('pricing.max.bullet3')}</Bullet>
                <Bullet>{t('pricing.max.bullet4')}</Bullet>
                <Bullet>{t('pricing.max.bullet5')}</Bullet>
              </ul>

              <Link href="/app" className="btn-sketch w-full" style={{ justifyContent: 'center' }}>
                {t('pricing.max.cta')}
              </Link>
            </div>
          </div>

          <p className="mt-10 text-center" style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
            {t('pricing.methods')}
            <br />
            {t.rich('pricing.processedBy', {
              provider: providerLabel,
              link: (chunks) => (
                <a
                  href={providerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--ink)', borderBottom: '1.4px solid var(--hi)', textDecoration: 'none' }}
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </section>

        {/* ─── HOW IT WORKS ─── */}
        <section className="px-20 py-16">
          <div className="mb-12 text-center">
            <div className="label-mono mb-3">// the flow</div>
            <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0 }}>
              {t('flow.heading')}
            </h2>
          </div>
          <div className="grid gap-10" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Step n={1} title={t('flow.step1.title')} desc={t('flow.step1.desc')} />
            <Step n={2} title={t('flow.step2.title')} desc={t('flow.step2.desc')} />
            <Step n={3} title={t('flow.step3.title')} desc={t('flow.step3.desc', { price: oneTimePrice })} />
          </div>
        </section>

        {/* ─── REFUND ─── */}
        <section style={{ borderTop: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div className="mx-auto px-10 py-16" style={{ maxWidth: 720 }}>
            <h2 className="text-center" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>
              {t('refund.heading')}
            </h2>
            <p
              className="mt-5 text-center"
              style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-2)' }}
            >
              {t.rich('refund.body', {
                strong: (chunks) => <strong style={{ color: 'var(--ink)' }}>{chunks}</strong>,
                mail: (chunks) => (
                  <a
                    href="mailto:support@excalicast.cn"
                    style={{ fontWeight: 600, color: 'var(--ink)', borderBottom: '1.4px solid var(--hi)', textDecoration: 'none' }}
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <div className="mt-6 text-center">
              <Link
                href="/refund"
                style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, borderBottom: '1.5px solid var(--ink)', textDecoration: 'none' }}
              >
                {t('refund.viewFull')}
              </Link>
            </div>
          </div>
        </section>

        {/* ─── CONTACT ─── */}
        <section id="contact" className="mx-auto px-10 py-16 text-center" style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>
            {t('contact.heading')}
          </h2>
          <p className="mt-4" style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--ink-2)' }}>
            {t('contact.body')}
          </p>
          <div
            className="mx-auto mt-6 inline-flex items-center gap-2.5"
            style={{
              padding: '12px 22px',
              background: 'var(--paper)',
              border: '1.5px solid var(--ink)',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
              boxShadow: '3px 3px 0 var(--ink)',
            }}
          >
            <I.Mail size={16} />
            <a
              href="mailto:support@excalicast.cn"
              style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}
            >
              support@excalicast.cn
            </a>
          </div>
        </section>

        {/* ─── FOOTER ─── */}
        <footer
          style={{
            background: 'var(--paper-2)',
            borderTop: '1.5px solid var(--ink)',
            padding: '24px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--ink-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <div className="flex items-center gap-3">
            <LogoMark size={20} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '-0.01em', color: 'var(--ink)', textTransform: 'none' }}>
              Excalicast
            </span>
            <span>© 2026 · excalicast.cn</span>
          </div>
          <nav className="flex flex-wrap gap-5">
            <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>{t('footer.home')}</Link>
            <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>{t('footer.privacy')}</Link>
            <Link href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>{t('footer.terms')}</Link>
            <Link href="/refund" style={{ color: 'inherit', textDecoration: 'none' }}>{t('footer.refund')}</Link>
            <a href="mailto:support@excalicast.cn" style={{ color: 'inherit', textDecoration: 'none' }}>{t('footer.contact')}</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}

function FeatureCard({
  tag,
  Icon,
  color,
  title,
  desc,
}: {
  tag: string;
  Icon: (p: { size?: number; sw?: number }) => JSX.Element;
  color: string;
  title: string;
  desc: string;
}) {
  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1.6px solid var(--ink)',
        borderRadius: 4,
        boxShadow: '3px 3px 0 var(--ink)',
        padding: 24,
        minHeight: 220,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          border: '1.5px solid var(--ink)',
          background: color,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
          boxShadow: '2px 2px 0 var(--ink)',
        }}
      >
        <Icon size={22} sw={1.6} />
      </div>
      <div className="label-mono mb-2">{tag}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.015em' }}>
        {title}
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{desc}</p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div
        className="mx-auto grid h-14 w-14 place-items-center"
        style={{
          background: 'var(--hi)',
          border: '1.6px solid var(--ink)',
          borderRadius: 4,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 700,
          boxShadow: '3px 3px 0 var(--ink)',
          color: 'var(--ink)',
        }}
      >
        {n}
      </div>
      <h3 className="mt-5" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h3>
      <p className="mt-2" style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>{desc}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <div
        style={{
          width: 16,
          height: 16,
          marginTop: 2,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink)',
        }}
      >
        <I.Check size={14} sw={2.4} />
      </div>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>{children}</span>
    </li>
  );
}
