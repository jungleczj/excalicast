import '../globals.css';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { PaddleProvider } from '@/components/providers/PaddleProvider';
import { LibraryImportHandler } from '@/components/LibraryImportHandler';
import { locales, type Locale } from '@/i18n/config';

// 预水合脚本：在 React/Excalidraw 启动前就把市集回流的 `#addLibrary=` 抓走并清掉，
// 存进 window.__excalicastPendingLib，杜绝任何后续脚本抢跑。无 hash 时立即 return。
const CAPTURE_HASH_SCRIPT = `(function(){try{var m=location.hash.match(/addLibrary=([^&]+)/);if(m){window.__excalicastPendingLib=decodeURIComponent(m[1]);history.replaceState(null,'',location.pathname+location.search);}}catch(e){}})();`;

export const metadata = {
  title: 'Excalicast',
  description: 'Whiteboard recording — one take, every aspect ratio',
};

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
          <PaddleProvider>{children}</PaddleProvider>
          <LibraryImportHandler />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
