import '../globals.css';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { PaddleProvider } from '@/components/providers/PaddleProvider';
import { locales, type Locale } from '@/i18n/config';

export const metadata = {
  title: 'Excalicast',
  description: 'Whiteboard recording — one take, every aspect ratio',
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
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PaddleProvider>{children}</PaddleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
