import { I } from '@/components/icons';
import { Brand } from '@/components/AppHeader';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.meta' });
  return { title: t('title'), description: t('description') };
}

export default async function LandingPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingContent />;
}

function LandingContent(): JSX.Element {
  const t = useTranslations('landing');
  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <header className="flex-shrink-0 border-b border-border-default bg-bg-primary">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Brand />
          <nav className="flex items-center gap-6 text-[13px] font-medium text-text-secondary">
            <a href="#pricing" className="hover:text-text-primary">{t('nav.pricing')}</a>
            <a href="#contact" className="hover:text-text-primary">{t('nav.contact')}</a>
            <Link href="/app" className="rounded-md bg-primary-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700">
              {t('nav.startRecording')}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-auto">

      <section
        className="relative overflow-hidden border-b border-border-default"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(37,99,235,0.06), transparent 60%), var(--bg-secondary)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--primary-300), transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-32 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--secondary-500), transparent 70%)' }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-bg-primary px-3 py-1 text-[12px] font-medium text-text-secondary shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {t('hero.badge')}
          </span>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.1] tracking-tight text-text-primary md:text-[60px]">
            {t('hero.titleLine1')}<br />
            <span
              style={{
                backgroundImage: 'linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-600) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {t('hero.titleLine2')}
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16.5px] leading-relaxed text-text-secondary">
            {t('hero.subtitle')}
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/app"
              className="rounded-lg bg-primary-600 px-7 py-3 text-[15px] font-semibold text-white shadow-lg transition hover:bg-primary-700 hover:shadow-xl"
              style={{ boxShadow: '0 10px 25px -5px rgba(37,99,235,0.3)' }}
            >
              {t('hero.ctaPrimary')}
            </Link>
            <a
              href="#pricing"
              className="rounded-lg border border-border-strong bg-bg-primary px-7 py-3 text-[15px] font-semibold text-text-primary transition hover:bg-bg-tertiary"
            >
              {t('hero.ctaSecondary')}
            </a>
          </div>
          <p className="mt-5 text-[12.5px] text-text-tertiary">
            {t('hero.disclaimer')}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-[28px] font-bold text-text-primary">{t('features.heading')}</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Feature icon={<I.Edit size={20} />} title={t('features.lossless.title')} desc={t('features.lossless.desc')} />
          <Feature icon={<I.Mic size={20} />} title={t('features.audio.title')} desc={t('features.audio.desc')} />
          <Feature icon={<I.Crop size={20} />} title={t('features.ratios.title')} desc={t('features.ratios.desc')} />
          <Feature icon={<I.Download size={20} />} title={t('features.local.title')} desc={t('features.local.desc')} />
          <Feature icon={<I.Camera size={20} />} title={t('features.camera.title')} desc={t('features.camera.desc')} />
          <Feature icon={<I.Lock size={20} />} title={t('features.privacy.title')} desc={t('features.privacy.desc')} />
        </div>
      </section>

      <section id="pricing" className="border-y border-border-default bg-bg-secondary">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-[28px] font-bold text-text-primary">{t('pricing.heading')}</h2>
          <p className="mt-3 text-center text-[14px] text-text-secondary">
            {t('pricing.subheading')}
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-border-default bg-bg-primary p-8">
              <div className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary">{t('pricing.free.label')}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[44px] font-bold leading-none text-text-primary">$0</span>
              </div>
              <p className="mt-2 text-[13px] text-text-secondary">{t('pricing.free.tagline')}</p>

              <ul className="mt-6 space-y-2.5 text-[13.5px] text-text-secondary">
                <Bullet>{t('pricing.free.bullet1')}</Bullet>
                <Bullet>{t('pricing.free.bullet2')}</Bullet>
                <Bullet>{t('pricing.free.bullet3')}</Bullet>
                <Bullet>{t('pricing.free.bullet4')}</Bullet>
              </ul>

              <Link href="/app" className="mt-8 block rounded-md border border-border-strong bg-bg-primary px-5 py-2.5 text-center text-[14px] font-semibold text-text-primary hover:bg-bg-tertiary">
                {t('pricing.free.cta')}
              </Link>
            </div>

            <div
              className="relative rounded-2xl p-8 text-white shadow-xl"
              style={{ background: 'linear-gradient(135deg, var(--accent-500) 0%, var(--accent-600) 100%)' }}
            >
              <div className="absolute right-5 top-5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
                {t('pricing.oneTime.recommended')}
              </div>
              <div className="text-[13px] font-semibold uppercase tracking-wider opacity-80">{t('pricing.oneTime.label')}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[44px] font-bold leading-none">$9.99</span>
                <span className="text-[13px] opacity-80">{t('pricing.oneTime.unit')}</span>
              </div>
              <p className="mt-2 text-[13px] opacity-90">{t('pricing.oneTime.tagline')}</p>

              <ul className="mt-6 space-y-2.5 text-[13.5px]">
                <Bullet light>{t('pricing.oneTime.bullet1')}</Bullet>
                <Bullet light>{t('pricing.oneTime.bullet2')}</Bullet>
                <Bullet light>{t('pricing.oneTime.bullet3')}</Bullet>
                <Bullet light>{t('pricing.oneTime.bullet4')}</Bullet>
                <Bullet light>{t('pricing.oneTime.bullet5')}</Bullet>
              </ul>

              <Link href="/app" className="mt-8 block rounded-md bg-white px-5 py-2.5 text-center text-[14px] font-semibold text-accent-600 shadow-md hover:bg-bg-secondary">
                {t('pricing.oneTime.cta')}
              </Link>
            </div>
          </div>

          <p className="mt-8 text-center text-[12px] text-text-tertiary">
            {t('pricing.methods')}
            <br />
            {t.rich('pricing.processedBy', {
              paddle: (chunks) => (
                <a href="https://www.paddle.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-primary">{chunks}</a>
              ),
            })}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-[28px] font-bold text-text-primary">{t('flow.heading')}</h2>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          <Step n={1} title={t('flow.step1.title')} desc={t('flow.step1.desc')} />
          <Step n={2} title={t('flow.step2.title')} desc={t('flow.step2.desc')} />
          <Step n={3} title={t('flow.step3.title')} desc={t('flow.step3.desc')} />
        </div>
      </section>

      <section className="border-t border-border-default bg-bg-secondary">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-center text-[24px] font-bold text-text-primary">{t('refund.heading')}</h2>
          <p className="mt-4 text-center text-[14px] leading-relaxed text-text-secondary">
            {t.rich('refund.body', {
              strong: (chunks) => <strong className="text-text-primary">{chunks}</strong>,
              mail: (chunks) => <a href="mailto:support@excalicast.cn" className="font-semibold text-primary-600 hover:underline">{chunks}</a>,
            })}
          </p>
          <div className="mt-6 text-center">
            <Link href="/refund" className="text-[13px] font-semibold text-primary-600 hover:underline">
              {t('refund.viewFull')}
            </Link>
          </div>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-[24px] font-bold text-text-primary">{t('contact.heading')}</h2>
        <p className="mt-4 text-[14px] leading-relaxed text-text-secondary">
          {t('contact.body')}
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border-default bg-bg-primary px-5 py-3 font-mono text-[14px]">
          <I.Mail size={16} className="text-text-tertiary" />
          <a href="mailto:support@excalicast.cn" className="text-text-primary hover:underline">
            support@excalicast.cn
          </a>
        </div>
      </section>

      <footer className="border-t border-border-default bg-bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 md:flex-row">
          <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
            <Brand />
            <span>© 2026 Excalicast</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-[12px] text-text-tertiary">
            <Link href="/" className="hover:text-text-primary">{t('footer.home')}</Link>
            <Link href="/privacy" className="hover:text-text-primary">{t('footer.privacy')}</Link>
            <Link href="/terms" className="hover:text-text-primary">{t('footer.terms')}</Link>
            <Link href="/refund" className="hover:text-text-primary">{t('footer.refund')}</Link>
            <a href="mailto:support@excalicast.cn" className="hover:text-text-primary">{t('footer.contact')}</a>
          </nav>
        </div>
      </footer>

      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="group rounded-xl border border-border-default bg-bg-primary p-6 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md">
      <div
        className="grid h-10 w-10 place-items-center rounded-lg text-primary-700 transition group-hover:scale-105"
        style={{ background: 'linear-gradient(135deg, var(--primary-100), var(--primary-50))' }}
      >
        {icon}
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{desc}</p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-600 text-[18px] font-bold text-white">
        {n}
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-text-secondary">{desc}</p>
    </div>
  );
}

function Bullet({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <I.Check size={14} sw={2.5} className={`mt-0.5 flex-shrink-0 ${light ? 'text-white' : 'text-success-600'}`} />
      <span>{children}</span>
    </li>
  );
}
