import { LegalLayout } from '@/components/LegalLayout';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrivacyZh } from './PrivacyZh';
import { PrivacyEn } from './PrivacyEn';
import { buildAlternates } from '@/lib/seo/alternates';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'privacy.meta' });
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: buildAlternates('/privacy', locale),
  };
}

export default async function PrivacyPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'privacy' });
  return (
    <LegalLayout title={t('title')} lastUpdated="2026-05-08">
      {locale === 'en' ? <PrivacyEn /> : <PrivacyZh />}
    </LegalLayout>
  );
}
