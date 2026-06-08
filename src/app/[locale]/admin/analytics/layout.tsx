import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// 内部工具页：禁止收录
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Analytics — Excalicast Admin',
};

export default function AdminAnalyticsLayout({ children }: { children: ReactNode }) {
  return children;
}
