import './globals.css';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/providers/SessionProvider';

export const metadata = {
  title: 'Excalicast',
  description: '白板录制 · 录一次得到 N 个比例的视频',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body className="h-screen antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
