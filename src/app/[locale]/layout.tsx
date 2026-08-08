import '../globals.css';
import '../animations.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale, getTranslations } from 'next-intl/server';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { MotionLayer } from '@/components/motion/MotionLayer';
import { PaddleProvider } from '@/components/providers/PaddleProvider';
import { LibraryImportHandler } from '@/components/LibraryImportHandler';
import { locales, type Locale } from '@/i18n/config';
import { SITE_URL } from '@/lib/seo/alternates';
import { OrganicLandingTracker } from '@/components/analytics/OrganicLandingTracker';
import { PageJourneyTracker } from '@/components/analytics/PageJourneyTracker';
import { MediaTaskProvider } from '@/components/providers/MediaTaskProvider';
import { RecordingLifecycleProvider } from '@/components/providers/RecordingLifecycleProvider';

// 预水合脚本：在 React/Excalidraw 启动前就把市集回流的 `#addLibrary=` 抓走并清掉，
// 存进 window.__excalicastPendingLib，杜绝任何后续脚本抢跑。无 hash 时立即 return。
const CAPTURE_HASH_SCRIPT = `(function(){try{var m=location.hash.match(/addLibrary=([^&]+)/);if(m){window.__excalicastPendingLib=decodeURIComponent(m[1]);history.replaceState(null,'',location.pathname+location.search);}}catch(e){}})();`;

// metadataBase + OpenGraph/Twitter 默认值在此统一设置；子页面用各自的 generateMetadata
// 覆盖 title/description/alternates。og:image / twitter:image 由同目录 opengraph-image.tsx
// 自动注入，无需在此手写。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing.meta' });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('title'), template: '%s · Excalicast' },
    description: t('description'),
    applicationName: 'Excalicast',
    openGraph: {
      type: 'website',
      siteName: 'Excalicast',
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      title: t('title'),
      description: t('description'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
  };
}

// 移动端：device-width + 适配刘海屏（分享页等全屏内容）
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function RootLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  if (!(locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale as Locale);

  const messages = await getMessages();
  const htmlLang = locale === 'zh' ? 'zh-CN' : 'en';

  return (
    <html lang={htmlLang}>
      <body className="h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: CAPTURE_HASH_SCRIPT }} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PaddleProvider>
            <RecordingLifecycleProvider>
              <MediaTaskProvider>{children}</MediaTaskProvider>
            </RecordingLifecycleProvider>
          </PaddleProvider>
          <LibraryImportHandler />
          <OrganicLandingTracker />
          <PageJourneyTracker />
        </NextIntlClientProvider>
        <MotionLayer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
