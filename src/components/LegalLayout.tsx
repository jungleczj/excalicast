import Link from 'next/link';
import { Brand } from '@/components/AppHeader';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** 末次更新日期，YYYY-MM-DD */
  lastUpdated: string;
  children: ReactNode;
}

/**
 * 三个法律页面（Privacy / Terms / Refund）的共享布局。
 * 顶部有一个简化的 marketing-style header（不是 AppHeader）+ 阅读区 + 法律导航 footer。
 */
export function LegalLayout({ title, lastUpdated, children }: Props): JSX.Element {
  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      {/* 顶部 marketing nav，与 landing 一致 */}
      <header className="flex-shrink-0 border-b border-border-default bg-bg-primary">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Brand />
          <nav className="flex items-center gap-6 text-[13px] font-medium text-text-secondary">
            <Link href="/" className="hover:text-text-primary">主页</Link>
            <Link href="/#pricing" className="hover:text-text-primary">价格</Link>
            <Link href="/#contact" className="hover:text-text-primary">联系我们</Link>
            <Link href="/app" className="rounded-md bg-primary-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700">
              开始录制
            </Link>
          </nav>
        </div>
      </header>

      {/* 内容滚动区 */}
      <main className="flex-1 overflow-auto">
        <article className="mx-auto max-w-3xl px-6 py-14">
          <header className="mb-10">
            <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-tertiary">
              <span className="inline-flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                最后更新：{lastUpdated}
              </span>
              <span aria-hidden>·</span>
              <span>主体：Excalicast</span>
            </div>
          </header>

          <div className="legal-prose">
            {children}
          </div>

          {/* 内嵌的"返回主页"行动 */}
          <div className="mt-12 rounded-2xl border border-border-default bg-bg-primary p-5 text-center text-[13px]">
            <p className="text-text-secondary">还有疑问？欢迎来信</p>
            <a
              href="mailto:hello@excalicast.app"
              className="mt-1 inline-block font-mono font-semibold text-primary-600 hover:underline"
            >
              hello@excalicast.app
            </a>
          </div>
        </article>

        {/* 全站 footer */}
        <footer className="border-t border-border-default bg-bg-primary">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-7 md:flex-row">
            <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
              <Brand />
              <span>© 2026 Excalicast</span>
            </div>
            <nav className="flex flex-wrap gap-5 text-[12px] text-text-tertiary">
              <Link href="/" className="hover:text-text-primary">主页</Link>
              <Link href="/privacy" className="hover:text-text-primary">隐私政策</Link>
              <Link href="/terms" className="hover:text-text-primary">服务条款</Link>
              <Link href="/refund" className="hover:text-text-primary">退款政策</Link>
              <a href="mailto:hello@excalicast.app" className="hover:text-text-primary">联系我们</a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}
