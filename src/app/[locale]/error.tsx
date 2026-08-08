'use client';

import { useEffect } from 'react';

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    console.error('[route-error]', {
      name: error.name,
      message: error.message,
      digest: error.digest,
      path: window.location.pathname,
    });
  }, [error]);

  const zh = typeof document !== 'undefined' && document.documentElement.lang.startsWith('zh');
  return (
    <main className="grid min-h-screen place-items-center bg-paper p-6 text-ink">
      <section className="w-full max-w-lg border border-ink bg-paper-2 p-6" style={{ borderRadius: 8, boxShadow: 'var(--hard)' }}>
        <h1 className="text-xl font-bold">{zh ? '此页面遇到了问题' : 'This page hit a problem'}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {zh ? '本地录制和已保存媒体不会因此被删除。可以重试当前页面。' : 'Your local recording and saved media were not deleted. You can retry this page.'}
        </p>
        <button type="button" onClick={reset} className="btn-sketch btn-sketch-primary mt-5">
          {zh ? '重试' : 'Retry'}
        </button>
      </section>
    </main>
  );
}
