import type { CSSProperties, JSX } from 'react';
import { I, LogoMark } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getActiveConfig, formatPrice } from '@/lib/paymentConfig';
import { buildAlternates } from '@/lib/seo/alternates';
import { JsonLd } from '@/components/seo/JsonLd';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import { softwareApplicationSchema, organizationSchema, faqPageSchema } from '@/lib/seo/schema';

interface Props {
  params: Promise<{ locale: string }>;
}

// 价格随 payment_config 变化：用 ISR（CDN 缓存 + stale-while-revalidate，TTFB 快），
// 而非 force-dynamic（每次访问都 SSR + 查 Supabase → TTFB 极差，冷启动叠加可达十几秒）。
// 改价/切 mode 时 admin 路由会 revalidatePath 立即再生，故价格仍准；3600s 为兜底窗口。
export const revalidate = 3600;

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

  return (
    <>
      <link rel="preload" as="image" href="/landing/hero-generated-final.png" />
      <JsonLd data={[productSchema, organizationSchema(), faqSchema]} />
      <LandingContent oneTimePrice={oneTimePrice} proPrice={proPrice} maxPrice={maxPrice} />
    </>
  );
}

const CAPABILITIES = [
  { key: 'record', Ic: I.Play, card: 'is-hero' },
  { key: 'edit', Ic: I.Crop, card: 'is-medium is-blue' },
  { key: 'caption', Ic: I.Captions, card: 'is-small is-cream' },
  { key: 'distribute', Ic: I.Share, card: 'is-wide is-green' },
  { key: 'archive', Ic: I.Library, card: 'is-wide is-lilac' },
] as const;

const PERSONAS = [
  { key: 'teacher', image: '/landing/personas/female-01.png', tone: '#EAF3FF' },
  { key: 'architect', image: '/landing/personas/male-03.png', tone: '#FFF0D7' },
  { key: 'pm', image: '/landing/personas/female-05.png', tone: '#EAF7EC' },
  { key: 'creator', image: '/landing/personas/male-06.png', tone: '#F2EDFF' },
  { key: 'course', image: '/landing/personas/female-07.png', tone: '#FFECEC' },
  { key: 'team', image: '/landing/personas/male-08.png', tone: '#EEF2F6' },
] as const;

const FEATURES = [
  { key: 'record', visual: 'record' },
  { key: 'organize', visual: 'organize' },
  { key: 'distribute', visual: 'distribute' },
  { key: 'archive', visual: 'archive' },
  { key: 'publish', visual: 'publish' },
] as const;

const LIBRARY_ITEMS = [
  { title: 'Microservices walkthrough', status: 'Cloud saved', visual: 'microservices' },
  { title: 'Q3 product roadmap', status: 'Local first', visual: 'roadmap' },
  { title: 'User journey teardown', status: 'Cloud saved', visual: 'journey' },
  { title: 'API auth flow', status: 'Local first', visual: 'auth' },
] as const;

function LandingContent({
  oneTimePrice,
  proPrice,
  maxPrice,
}: {
  oneTimePrice: string;
  proPrice: string;
  maxPrice: string;
}): JSX.Element {
  const t = useTranslations('landing');
  const tiers = [
    { tier: 'free' as const, name: t('pricing.free.label'), price: '$0', unit: t('pricingTeaser.free.unit'), body: t('pricingTeaser.free.body'), cta: t('pricingTeaser.free.cta'), featured: false },
    { tier: 'one_time' as const, name: t('pricing.oneTime.label'), price: oneTimePrice, unit: t('pricingTeaser.oneTime.unit'), body: t('pricingTeaser.oneTime.body'), cta: t('pricingTeaser.oneTime.cta'), featured: false },
    { tier: 'pro' as const, name: t('pricing.pro.label'), price: proPrice, unit: t('pricingTeaser.pro.unit'), body: t('pricingTeaser.pro.body'), cta: t('pricingTeaser.pro.cta'), featured: true },
    { tier: 'max' as const, name: t('pricing.max.label'), price: maxPrice, unit: t('pricingTeaser.max.unit'), body: t('pricingTeaser.max.body'), cta: t('pricingTeaser.max.cta'), featured: false },
  ];

  return (
    <div className="craft-landing flex h-full flex-col" style={{ background: 'var(--craft-cream)', color: 'var(--craft-ink)' }}>
      <CraftHeader t={t} />

      <main className="flex-1 overflow-auto">
        <div className="craft-page-shell">
          <HeroSection t={t} />
          <CapabilitySection t={t} />
          <PersonaSection t={t} />
          <NarrativeSection t={t} />
          <PricingRhythm t={t} tiers={tiers} />
          <FaqSection t={t} oneTimePrice={oneTimePrice} />
          <FinalCta t={t} />
          <CraftFooter t={t} />
        </div>
      </main>
    </div>
  );
}

function CraftHeader({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <header className="craft-site-header">
      <Link href="/" className="craft-brand" aria-label="Excalicast home">
        <LogoMark size={30} />
        <span>Excalicast</span>
      </Link>

      <nav className="craft-nav-links" aria-label="Main navigation">
        <Link href="/" className="is-active">{t('craft.nav.home')}</Link>
        <Link href="/library">{t('craft.nav.library')}</Link>
        <a href="#pricing">{t('craft.nav.pricing')}</a>
        <a href="/api/desktop/download?platform=mac">{t('craft.nav.downloadMac')}</a>
      </nav>

      <div className="craft-nav-actions">
        <Link href={"/app?login=1" as never} className="craft-icon-link" aria-label={t('craft.nav.login')}>
          <I.User size={17} />
        </Link>
        <TrackedLink event="cta_start_recording" eventProps={{ surface: 'nav' }} prefetchKind="whiteboard" href="/app" className="craft-primary-link">
          <span className="rec-dot" style={{ width: 6, height: 6 }} />
          {t('craft.nav.start')}
        </TrackedLink>
        <details className="craft-mobile-menu">
          <summary aria-label={t('craft.nav.menu')}>
            <span />
            <span />
            <span />
          </summary>
          <nav aria-label={t('craft.nav.menu')}>
            <Link href="/">{t('craft.nav.home')}</Link>
            <Link href="/library">{t('craft.nav.library')}</Link>
            <a href="#pricing">{t('craft.nav.pricing')}</a>
            <a href="/api/desktop/download?platform=mac">{t('craft.nav.downloadMac')}</a>
          </nav>
        </details>
      </div>
    </header>
  );
}

function HeroSection({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <section className="craft-hero craft-paper-card parallax-host">
      <div className="craft-hero-generated-clip" aria-hidden="true">
        <img className="craft-hero-generated-visual" src="/landing/hero-generated-final.png" alt="" draggable={false} />
      </div>

      <div className="craft-hero-copy reveal-up">
        <p className="craft-hero-eyebrow">{t('craft.hero.eyebrow')}</p>
        <h1>{t('craft.hero.title')}</h1>
        <p className="craft-hero-body">{t('craft.hero.body')}</p>
        <div className="craft-hero-actions">
          <TrackedLink event="cta_start_recording" eventProps={{ surface: 'hero' }} prefetchKind="whiteboard" href="/app" className="craft-primary-link craft-hero-primary">
            <span className="rec-dot" style={{ width: 7, height: 7 }} />
            {t('craft.hero.primary')}
          </TrackedLink>
          <a href="#pricing" className="craft-secondary-link craft-hero-secondary">
            {t('craft.hero.secondary')}
          </a>
        </div>
        <p className="craft-microcopy">{t('craft.hero.microcopy')}</p>
      </div>
    </section>
  );
}


function FlowchartScene(): JSX.Element {
  return (
    <svg viewBox="0 0 900 430" className="craft-flowchart" role="img" aria-label="Web App to API Server, Database and Object Storage flowchart">
      <defs>
        <filter id="softPencil" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence baseFrequency="0.9" numOctaves="1" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.6" />
        </filter>
      </defs>
      <g filter="url(#softPencil)" fill="none" stroke="#1f2225" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="96" y="138" width="190" height="110" rx="8" fill="#F2ECFF" />
        <rect x="366" y="132" width="210" height="118" rx="8" fill="#FFF1D6" />
        <path d="M685 125 c55 0 88 18 88 38 v96 c0 20 -33 38 -88 38 c-55 0 -88 -18 -88 -38 v-96 c0 -20 33 -38 88 -38 z" fill="#F7F7F5" />
        <path d="M597 163 c0 20 33 38 88 38 c55 0 88 -18 88 -38" />
        <path d="M597 211 c0 20 33 38 88 38 c55 0 88 -18 88 -38" />
        <path d="M286 193 H350" />
        <path d="M342 182 l14 11 l-14 11" />
        <path d="M576 193 H638" />
        <path d="M630 182 l14 11 l-14 11" />
        <path d="M508 250 c48 36 40 84 -12 104" />
        <path d="M501 340 l-8 16 l18 1" />
        <path d="M452 336 c-76 44 -210 41 -280 0 c-28 -17 -20 -51 18 -58" />
        <path d="M183 285 l9 -12 l8 15" />
      </g>
      <g fill="#1f2225" fontFamily="var(--font-virgil)" textAnchor="middle">
        <text x="191" y="180" fontSize="31">Web App</text>
        <text x="321" y="183" fontSize="22" textAnchor="middle">HTTPS</text>
        <text x="471" y="176" fontSize="31">API Server</text>
        <text x="687" y="336" fontSize="30">Database</text>
      </g>
      <g stroke="#1f2225" strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="191" cy="213" r="25" />
        <path d="M166 213 h50 M191 188 c17 20 17 30 0 50 M191 188 c-17 20 -17 30 0 50" />
        <rect x="432" y="194" width="78" height="18" rx="3" fill="#fffaf2" />
        <rect x="432" y="219" width="78" height="18" rx="3" fill="#fffaf2" />
        <rect x="432" y="169" width="78" height="18" rx="3" fill="#fffaf2" />
        <circle cx="444" cy="178" r="2.5" fill="#1f2225" />
        <circle cx="444" cy="203" r="2.5" fill="#1f2225" />
        <circle cx="444" cy="228" r="2.5" fill="#1f2225" />
        <path d="M472 178 h23 M472 203 h23 M472 228 h23" />
      </g>
      <g filter="url(#softPencil)" stroke="#1f2225" strokeWidth="4" fill="#E7F3FF" strokeLinejoin="round" strokeLinecap="round">
        <path d="M478 344 c-24 0 -43 -15 -43 -35 c0 -17 14 -31 33 -34 c6 -31 38 -54 75 -54 c31 0 58 16 70 39 c28 1 50 20 50 44 c0 22 -21 40 -48 40 z" />
      </g>
      <text x="550" y="316" textAnchor="middle" fontFamily="var(--font-virgil)" fontSize="28" fill="#1f2225">Object Storage</text>
    </svg>
  );
}

function CameraPortrait(): JSX.Element {
  return (
    <div className="craft-camera-bubble" aria-label="Camera portrait preview">
      <div className="craft-camera-face">
        <div className="hair" />
        <div className="face" />
        <div className="shirt" />
      </div>
    </div>
  );
}

function SlimRecordingBar({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  const items = [
    { label: t('craft.controls.pause'), Ic: I.Pause },
    { label: t('craft.controls.stop'), Ic: I.Stop, danger: true },
    { label: t('craft.controls.mic'), Ic: I.Mic },
    { label: t('craft.controls.camera'), Ic: I.Camera },
    { label: t('craft.controls.laser'), Ic: I.Laser },
    { label: t('craft.controls.zoom'), Ic: I.Search },
    { label: t('craft.controls.prompt'), Ic: I.Doc },
  ];
  return (
    <div className="craft-recording-bar" aria-label={t('craft.controls.label')}>
      <div className="craft-recording-clock">
        <span className="rec-dot" style={{ width: 8, height: 8 }} />
        <span>REC</span>
        <span>12:48</span>
      </div>
      {items.map(({ label, Ic, danger }) => (
        <div key={label} className={danger ? 'is-danger' : undefined}>
          <span><Ic size={18} sw={1.8} /></span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

function CapabilitySection({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <section className="craft-centered-section craft-capabilities">
      <div className="craft-section-heading reveal-up">
        <h2>{t('craft.capabilities.heading')}</h2>
      </div>
      <div className="craft-capability-grid stagger">
        {CAPABILITIES.map(({ key, Ic, card }) => (
          <div key={key} className={`craft-capability reveal-up ${card}`}>
            <span>
              <Ic size={26} />
            </span>
            <h3>{t(`craft.capabilities.${key}.title`)}</h3>
            <p>{t(`craft.capabilities.${key}.body`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PersonaSection({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <section className="craft-personas">
      <div className="craft-section-heading">
        <h2>{t('craft.personas.heading')}</h2>
      </div>
      <div className="marquee craft-persona-marquee" style={{ ['--marq-dur' as string]: '46s' } as CSSProperties}>
        <PersonaTrack t={t} />
        <PersonaTrack t={t} ariaHidden />
      </div>
    </section>
  );
}

function PersonaTrack({ t, ariaHidden = false }: { t: ReturnType<typeof useTranslations>; ariaHidden?: boolean }): JSX.Element {
  return (
    <div className="__marq-track" aria-hidden={ariaHidden || undefined}>
      {PERSONAS.map((p) => (
        <article key={p.key} className="craft-persona-card" style={{ background: p.tone }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.image}
            alt=""
            width={1122}
            height={1402}
            decoding="sync"
            draggable={false}
          />
          <div>
            <p>{t(`craft.personas.${p.key}.role`)}</p>
            <h3>{t(`craft.personas.${p.key}.title`)}</h3>
            <span>{t(`craft.personas.${p.key}.use`)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function NarrativeSection({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <section className="craft-narrative">
      {FEATURES.map((feature, index) => (
        <NarrativeCard key={feature.key} t={t} featureKey={feature.key} visual={feature.visual} reverse={index % 2 === 1} />
      ))}
    </section>
  );
}

function NarrativeCard({
  t,
  featureKey,
  visual,
  reverse,
}: {
  t: ReturnType<typeof useTranslations>;
  featureKey: string;
  visual: 'record' | 'organize' | 'distribute' | 'archive' | 'publish';
  reverse: boolean;
}): JSX.Element {
  return (
    <article className={`craft-feature-card reveal-up is-${visual}` + (reverse ? ' is-reverse' : '')}>
      <div className="craft-feature-copy">
        <p className="craft-eyebrow">{t(`craft.features.${featureKey}.kicker`)}</p>
        <h2>{t(`craft.features.${featureKey}.title`)}</h2>
        <p>{t(`craft.features.${featureKey}.body`)}</p>
        <Link href={visual === 'archive' ? '/library' : '/app'} className="craft-secondary-link">
          {t(`craft.features.${featureKey}.cta`)}
        </Link>
      </div>
      <div className="craft-feature-visual">
        <FeatureVisual visual={visual} />
      </div>
    </article>
  );
}

function FeatureVisual({ visual }: { visual: 'record' | 'organize' | 'distribute' | 'archive' | 'publish' }): JSX.Element {
  if (visual === 'record') return <RecordingVisual />;
  if (visual === 'organize') return <EditorVisual />;
  if (visual === 'distribute') return <DistributionVisual />;
  if (visual === 'archive') return <ArchiveVisual />;
  return <PublishVisual />;
}

function RecordingVisual(): JSX.Element {
  return (
    <div className="craft-feature-shot craft-feature-shot-hero">
      <object
        data="/landing/hero-product-exact.svg"
        type="image/svg+xml"
        width={1430}
        height={754}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

function EditorVisual(): JSX.Element {
  return (
    <div className="craft-editor-mock">
      <div className="craft-player-strip">
        <span><I.Play size={16} /></span>
        <div><span /></div>
        <small>02:14 / 08:46</small>
      </div>
      <div className="craft-timeline">
        <div className="track canvas">
          {Array.from({ length: 7 }).map((_, i) => <span key={i} />)}
        </div>
        <div className="track audio" />
        <div className="track captions">
          {Array.from({ length: 4 }).map((_, i) => <span key={i} />)}
        </div>
      </div>
      <div className="craft-inspector">
        <span>16:9</span>
        <span>9:16</span>
        <span>1:1</span>
        <span>4:5</span>
      </div>
    </div>
  );
}

function DistributionVisual(): JSX.Element {
  return (
    <div className="craft-distribution">
      {[
        ['16:9', 'Long video'],
        ['9:16', 'Shorts'],
        ['1:1', 'Feed'],
        ['4:5', 'Social'],
      ].map(([ratio, label], index) => (
        <div key={ratio} className={index === 1 ? 'is-tall' : undefined}>
          <strong>{ratio}</strong>
          <span>{label}</span>
        </div>
      ))}
      <p>One recording can become every format your channels need.</p>
    </div>
  );
}

function ArchiveVisual(): JSX.Element {
  return (
    <div className="craft-library-mock">
      <div className="craft-library-toolbar">
        <span>Search title, tag, notes...</span>
        <button type="button"><I.CloudUpload size={15} /> Back up</button>
      </div>
      <div className="craft-library-grid">
        {LIBRARY_ITEMS.map((item) => (
          <div key={item.title}>
            <div><LibraryThumb visual={item.visual} /></div>
            <h4>{item.title}</h4>
            <p>{item.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryThumb({ visual }: { visual: (typeof LIBRARY_ITEMS)[number]['visual'] }): JSX.Element {
  if (visual === 'microservices') return <FlowchartScene />;

  if (visual === 'roadmap') {
    return (
      <svg viewBox="0 0 420 190" className="craft-library-thumb" aria-hidden="true">
        <g className="pencil" fill="none" stroke="#1f2225" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M46 78 H374" />
          <path d="M100 69 v18 M190 69 v18 M280 69 v18 M352 69 v18" />
          <path d="M370 78 l-14 -10 M370 78 l-14 10" />
          <rect x="54" y="101" width="74" height="36" rx="5" fill="#F2ECFF" />
          <rect x="148" y="101" width="104" height="36" rx="5" fill="#FFF1D6" />
          <rect x="270" y="101" width="72" height="36" rx="5" fill="#E7F3FF" />
          <path d="M96 137 c22 25 76 24 94 1" />
          <path d="M186 130 l8 12 l-15 0" />
        </g>
        <g className="label" fill="#1f2225" textAnchor="middle">
          <text x="100" y="55">July</text>
          <text x="190" y="55">Aug</text>
          <text x="280" y="55">Sep</text>
          <text x="91" y="124">Research</text>
          <text x="200" y="124">Build</text>
          <text x="306" y="124">Launch</text>
        </g>
      </svg>
    );
  }

  if (visual === 'journey') {
    return (
      <svg viewBox="0 0 420 190" className="craft-library-thumb" aria-hidden="true">
        <g className="pencil" fill="none" stroke="#1f2225" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M58 95 C103 42 151 143 197 92 S291 47 346 95" />
          <path d="M90 95 h46 M166 95 h46 M242 95 h46 M318 95 h36" />
          <path d="M128 86 l13 9 l-13 9 M204 86 l13 9 l-13 9 M280 86 l13 9 l-13 9" />
          <circle cx="62" cy="95" r="18" fill="#FFF1D6" />
          <circle cx="144" cy="95" r="18" fill="#E7F3FF" />
          <circle cx="226" cy="95" r="18" fill="#EAF7EC" />
          <circle cx="308" cy="95" r="18" fill="#F2ECFF" />
          <path d="M350 76 c18 0 31 13 31 29 c0 26 -31 42 -31 42 s-31 -16 -31 -42 c0 -16 13 -29 31 -29 z" fill="#FFECEC" />
          <path d="M114 146 C190 171 262 168 334 142" strokeDasharray="6 8" />
        </g>
        <g className="label" fill="#1f2225" textAnchor="middle">
          <text x="62" y="135">Find</text>
          <text x="144" y="135">Visit</text>
          <text x="226" y="135">Join</text>
          <text x="308" y="135">Use</text>
          <text x="350" y="166">Return</text>
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 420 190" className="craft-library-thumb" aria-hidden="true">
      <g className="pencil" fill="none" stroke="#1f2225" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="44" y="61" width="76" height="50" rx="6" fill="#E7F3FF" />
        <rect x="167" y="58" width="90" height="56" rx="7" fill="#FFF1D6" />
        <rect x="304" y="58" width="72" height="56" rx="7" fill="#F2ECFF" />
        <path d="M120 86 H162 M256 86 H300" />
        <path d="M155 76 l13 10 l-13 10 M293 76 l13 10 l-13 10" />
        <path d="M212 114 C213 149 149 150 111 125" />
        <path d="M117 140 l-10 -18 l20 2" />
        <path d="M212 114 C218 151 315 151 340 124" strokeDasharray="7 8" />
        <path d="M336 139 l8 -18 l-20 4" />
        <path d="M331 83 v-13 c0 -13 9 -22 20 -22 c12 0 21 9 21 22 v13" />
        <rect x="323" y="84" width="57" height="38" rx="6" fill="#f8f8f4" />
      </g>
      <g className="label" fill="#1f2225" textAnchor="middle">
        <text x="82" y="92">Client</text>
        <text x="212" y="82">API</text>
        <text x="212" y="102">Gateway</text>
        <text x="340" y="86">Auth</text>
        <text x="340" y="106">Service</text>
        <text x="141" y="50">Token</text>
        <text x="284" y="50">Validate</text>
        <text x="212" y="153">OK</text>
      </g>
    </svg>
  );
}

function PublishVisual(): JSX.Element {
  return (
    <div className="craft-export-mock">
      <div className="craft-export-tabs">
        <span className="is-active">Export</span>
        <span>Captions</span>
        <span>Outline</span>
        <span>Handout</span>
      </div>
      <div className="craft-export-options">
        {['MP4', 'WebM', 'GIF'].map((f) => <span key={f}>{f}</span>)}
      </div>
      <div className="craft-export-summary">
        <p>Watermarked exports stay with rendering. Upgrade to publish clean versions.</p>
        <button type="button"><I.Download size={16} /> Render and download</button>
      </div>
    </div>
  );
}

function PricingRhythm({
  t,
  tiers,
}: {
  t: ReturnType<typeof useTranslations>;
  tiers: Array<{ tier: 'free' | 'one_time' | 'pro' | 'max'; name: string; price: string; unit: string; body: string; cta: string; featured: boolean }>;
}): JSX.Element {
  return (
    <section id="pricing" className="craft-centered-section craft-pricing">
      <div className="craft-section-heading reveal-up">
        <p className="craft-eyebrow">{t('craft.pricing.kicker')}</p>
        <h2>{t('craft.pricing.heading')}</h2>
        <p>{t('craft.pricing.body')}</p>
      </div>
      <div className="craft-pricing-duo">
        <article className="craft-plan-card is-light reveal-up">
          <div className="craft-plan-card-head">
            <p className="craft-eyebrow">{t('craft.pricing.startKicker')}</p>
            <h3>{t('craft.pricing.startTitle')}</h3>
          </div>
          <div className="craft-plan-rows">
            {tiers.slice(0, 2).map((tier) => (
              <div key={tier.tier} className="craft-plan-row">
                <div>
                  <h4>{tier.name}</h4>
                  <p>{tier.body}</p>
                </div>
                <div>
                  <strong>{tier.price}</strong>
                  <span>{tier.unit}</span>
                  <TrackedLink event="pricing_cta_click" eventProps={{ tier: tier.tier, surface: 'landing_craft' }} href="/app" className="craft-secondary-link">
                    {tier.cta}
                  </TrackedLink>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="craft-plan-card is-dark reveal-up">
          <div className="craft-plan-card-head">
            <div className="craft-plus-lockup">
              <LogoMark size={34} />
              <span>Excalicast</span>
              <em>PLUS</em>
            </div>
            <h3>{t('craft.pricing.publishTitle')}</h3>
          </div>
          <div className="craft-plan-rows">
            {tiers.slice(2).map((tier) => (
              <div key={tier.tier} className="craft-plan-row">
                <div>
                  <h4>{tier.name}</h4>
                  <p>{tier.body}</p>
                </div>
                <div>
                  {tier.featured && <span className="craft-price-badge">{t('pricing.pro.recommended')}</span>}
                  <strong>{tier.price}</strong>
                  <span>{tier.unit}</span>
                  <TrackedLink event="pricing_cta_click" eventProps={{ tier: tier.tier, surface: 'landing_craft' }} href="/app" className="craft-primary-link">
                    {tier.cta}
                  </TrackedLink>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function FaqSection({ t, oneTimePrice }: { t: ReturnType<typeof useTranslations>; oneTimePrice: string }): JSX.Element {
  return (
    <section id="faq" className="craft-centered-section craft-faq">
      <div className="craft-section-heading reveal-up">
        <h2>{t('craft.faq.heading')}</h2>
        <p>{t('craft.faq.body')}</p>
      </div>
      <div className="craft-faq-grid">
        {[1, 3, 4, 5, 7, 9].map((i) => (
          <details key={i} className="reveal-up">
            <summary>
              <span>{t(`faq.q${i}.q`)}</span>
              <I.Plus size={15} />
            </summary>
            <p>{t(`faq.q${i}.a`, { price: oneTimePrice })}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <section className="craft-final-cta craft-paper-card reveal-up">
      <div className="craft-paper-noise" />
      <h2>{t('craft.final.heading')}</h2>
      <p>{t('craft.final.body')}</p>
      <div>
        <TrackedLink event="cta_start_recording" eventProps={{ surface: 'final' }} prefetchKind="whiteboard" href="/app" className="craft-primary-link">
          <span className="rec-dot" style={{ width: 7, height: 7 }} />
          {t('craft.final.primary')}
        </TrackedLink>
        <a href="mailto:support@excalicast.cn" className="craft-secondary-link">{t('craft.final.secondary')}</a>
      </div>
    </section>
  );
}

function CraftFooter({ t }: { t: ReturnType<typeof useTranslations> }): JSX.Element {
  return (
    <footer className="craft-footer">
      <div className="craft-footer-card">
        <div className="craft-footer-hero">
          <div className="craft-footer-brand">
            <LogoMark size={40} />
            <span>Excalicast</span>
          </div>
          <div>
            <h2>{t('craft.footer.heading')}</h2>
            <p>{t('craft.footer.tagline')}</p>
          </div>
        </div>

        <nav className="craft-footer-columns" aria-label="Footer navigation">
          <div>
            <h3>{t('craft.footer.product')}</h3>
            <Link href="/">{t('craft.nav.home')}</Link>
            <Link href="/library">{t('craft.nav.library')}</Link>
            <Link href="/pricing">{t('craft.footer.pricing')}</Link>
          </div>
          <div>
            <h3>{t('craft.footer.learn')}</h3>
            <Link href="/use-cases">{t('footer.useCases')}</Link>
            <Link href="/compare">{t('footer.compare')}</Link>
            <Link href="/blog">{t('footer.blog')}</Link>
            <Link href="/use-cases/record-edit-publish-whiteboard-video">{t('craft.footer.workflow')}</Link>
            <Link href="/compare/excalicast-vs-excalicord">{t('craft.footer.excalicord')}</Link>
            <Link href="/use-cases/whiteboard-recording-tool">{t('craft.footer.whiteboardTool')}</Link>
            <Link href="/use-cases/record-excalidraw-to-video">{t('craft.footer.excalidraw')}</Link>
          </div>
          <div>
            <h3>{t('craft.footer.company')}</h3>
            <Link href="/privacy">{t('footer.privacy')}</Link>
            <Link href="/terms">{t('footer.terms')}</Link>
            <Link href="/refund">{t('footer.refund')}</Link>
          </div>
          <div>
            <h3>{t('craft.footer.support')}</h3>
            <a href="mailto:support@excalicast.cn">{t('footer.contact')}</a>
            <a href="mailto:support@excalicast.cn">support@excalicast.cn</a>
          </div>
        </nav>

        <div className="craft-footer-bottom">
          <small>© 2026 Excalicast · {t('craft.footer.rights')}</small>
          <TrackedLink event="cta_start_recording" eventProps={{ surface: 'footer' }} prefetchKind="whiteboard" href="/app" className="craft-primary-link">
            <span className="rec-dot" style={{ width: 7, height: 7 }} />
            {t('craft.nav.start')}
          </TrackedLink>
        </div>
      </div>
    </footer>
  );
}
