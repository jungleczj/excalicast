import './globals.css';
import type { ReactNode } from 'react';
import { PaddleProvider } from '@/components/providers/PaddleProvider';

export const metadata = {
  title: 'Excalicast',
  description: '白板录制 · 录一次得到 N 个比例的视频',
};

/**
 * Supabase Auth 走 cookie 持久化（middleware.ts 自动刷新），不需要
 * React Context 包裹。useAuth() hook 内部用 supabase.auth.onAuthStateChange
 * 自己订阅会话变化。
 */
export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body className="h-screen antialiased">
        <PaddleProvider>{children}</PaddleProvider>
      </body>
    </html>
  );
}
