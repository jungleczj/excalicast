import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** 末次更新日期，YYYY-MM-DD */
  lastUpdated: string;
  children: ReactNode;
}

/**
 * 三个法律页面（Privacy / Terms / Refund）的共享布局。
 * Tailwind typography 不在依赖里，所以排版用手写工具类。
 */
export function LegalLayout({ title, lastUpdated, children }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <AppHeader tier="free" />
      <main className="flex-1 overflow-auto bg-bg-secondary">
        <article className="mx-auto max-w-3xl px-6 py-10">
          <header className="mb-7 border-b border-border-default pb-5">
            <h1 className="text-[28px] font-bold leading-tight text-text-primary">{title}</h1>
            <p className="mt-2 text-[12px] text-text-tertiary">
              最后更新：{lastUpdated} · 主体：Excalicast
            </p>
          </header>
          <div className="legal-prose space-y-5 text-[14px] leading-[1.7] text-text-primary">
            {children}
          </div>
          <footer className="mt-10 flex flex-wrap gap-3 border-t border-border-default pt-5 text-[12px] text-text-tertiary">
            <Link href="/privacy" className="hover:text-text-primary hover:underline">隐私政策</Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-text-primary hover:underline">服务条款</Link>
            <span>·</span>
            <Link href="/refund" className="hover:text-text-primary hover:underline">退款政策</Link>
            <span>·</span>
            <Link href="/" className="hover:text-text-primary hover:underline">返回主页</Link>
            <span>·</span>
            <a href="mailto:hello@excalicast.app" className="hover:text-text-primary hover:underline">联系我们</a>
          </footer>
        </article>
      </main>
    </div>
  );
}
