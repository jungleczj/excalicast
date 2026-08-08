'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { RecordingsList } from '@/components/RecordingsList';
import { I } from '@/components/icons';
import { trackEvent } from '@/lib/analytics/track';

export default function LibraryPage(): JSX.Element {
  const t = useTranslations('library');
  const locale = useLocale();
  const [stats, setStats] = useState<{ count: number; totalMs: number }>({ count: 0, totalMs: 0 });
  const [draft, setDraft] = useState('');   // 输入草稿
  const [query, setQuery] = useState('');   // 已提交查询（下传 RecordingsList 过滤）

  // 进入录制库埋点
  useEffect(() => { trackEvent('library_view'); }, []);

  // 点 Search / 回车才提交查询（非即时过滤）
  const submitSearch = useCallback(() => {
    const q = draft.trim();
    setQuery(q);
    if (q) trackEvent('library_search', { len: q.length });
  }, [draft]);

  // 兜底：万一 libraries.excalidraw.com 市集把 addLibrary hash 甩到了 /library（理论
  // 上不该，但用户实测出现过），立刻转发到 /app 让 Whiteboard 完成 import。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash;
    if (h && h.includes('addLibrary=')) {
      window.location.replace(`/${locale}/app${h}`);
    }
  }, [locale]);

  const totalMin = Math.round(stats.totalMs / 60_000);
  const heading = locale === 'en' ? 'Library' : '录制库';
  const subline = locale === 'en'
    ? `// ${stats.count} RECORDING${stats.count === 1 ? '' : 'S'} · ${totalMin} MIN TOTAL · STORED LOCALLY`
    : `// ${stats.count} 条录制 · 共 ${totalMin} 分钟 · 存于本机`;

  const description = locale === 'en'
    ? 'Every recording stays on this device until you choose to export. Pro / Max users see cloud backups too.'
    : '每条录制都保留在本机，直到你主动导出。Pro / Max 用户还会看到云端备份。';

  return (
    <div className="app-craft-screen library-craft-page flex h-full flex-col">
      <AppHeader tier="free" />

      <div className="library-craft-main flex-1 overflow-auto">
        <div className="library-craft-wrap">
          {/* Title row */}
          <div className="library-craft-title-row mb-6 flex items-end justify-between">
            <div>
              <div className="library-craft-kicker label-mono">{subline}</div>
              <h1 className="library-craft-heading">
                {heading}
              </h1>
              <p
                className="library-craft-description"
                style={{ fontSize: 14, color: 'var(--ink-2)', maxWidth: 460, lineHeight: 1.5 }}
              >
                {description}
              </p>
            </div>
          </div>

          <div className="library-craft-search-row mb-4 flex justify-end">
            <div className="library-craft-actions flex items-center gap-3">
            <div
              className="library-craft-search flex items-center gap-2"
              style={{ padding: '9px 14px', border: '1.5px solid var(--ink)', borderRadius: 3, background: 'var(--paper)', width: 280, boxShadow: '2px 2px 0 var(--ink)' }}
            >
              <I.Search size={14} />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
                placeholder={t('searchPlaceholder')}
                className="w-full bg-transparent outline-none"
                style={{ border: 'none', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}
              />
            </div>
            <button
              type="button"
              onClick={submitSearch}
              className="library-craft-search-button"
            >
              <I.Search size={13} />
              {t('searchButton')}
            </button>
            </div>
          </div>

          <RecordingsList query={query} onStatsChange={setStats} />
        </div>
      </div>
    </div>
  );
}
