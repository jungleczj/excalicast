import { LegalLayout } from '@/components/LegalLayout';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RefundZh } from './RefundZh';
import { RefundEn } from './RefundEn';
import { buildAlternates } from '@/lib/seo/alternates';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'refund.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: buildAlternates('/refund', locale),
  };
}

export default async function RefundPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'refund' });
  return (
    <LegalLayout title={t('title')} lastUpdated="2026-05-08">
      {locale === 'en' ? <RefundEn /> : <RefundZh />}
    </LegalLayout>
  );
}
