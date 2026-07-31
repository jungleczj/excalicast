import { LegalLayout } from '@/components/LegalLayout';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TermsZh } from './TermsZh';
import { TermsEn } from './TermsEn';
import { getActiveConfig, formatPrice } from '@/lib/paymentConfig';
import { buildAlternates } from '@/lib/seo/alternates';

interface Props {
  params: Promise<{ locale: string }>;
}

// 价格用 ISR（CDN 缓存，TTFB 快）而非 force-dynamic；改价时 admin 路由 revalidatePath 立即再生。
export const revalidate = 3600;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'terms.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: buildAlternates('/terms', locale),
  };
}

export default async function TermsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'terms' });
  const cfg = await getActiveConfig();
  const oneTimePrice = cfg ? formatPrice(cfg.oneTimePriceCents, cfg.currency) : '$4.99';
  return (
    <LegalLayout title={t('title')} lastUpdated="2026-05-08">
      {locale === 'en' ? <TermsEn oneTimePrice={oneTimePrice} /> : <TermsZh oneTimePrice={oneTimePrice} />}
    </LegalLayout>
  );
}
