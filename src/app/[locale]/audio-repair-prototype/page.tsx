import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { AudioRepairPrototype } from './AudioRepairPrototype';

export const metadata = { robots: { index: false, follow: false } };

export default async function AudioRepairPrototypePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  if (process.env.NODE_ENV === 'production') notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <AudioRepairPrototype />;
}
