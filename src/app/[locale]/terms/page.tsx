import { LegalLayout } from '@/components/LegalLayout';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TermsZh } from './TermsZh';
import { TermsEn } from './TermsEn';
import { getActiveConfig, formatPrice } from '@/lib/paymentConfig';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'terms.meta' });
  return { title: t('title'), description: t('description') };
}

export default async function TermsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'terms' });
  const cfg = await getActiveConfig();
  const oneTimePrice = cfg ? formatPrice(cfg.oneTimePriceCents, cfg.currency) : '$9.99';
  return (
    <LegalLayout title={t('title')} lastUpdated="2026-05-08">
      {locale === 'en' ? <TermsEn oneTimePrice={oneTimePrice} /> : <TermsZh oneTimePrice={oneTimePrice} />}
    </LegalLayout>
  );
}
