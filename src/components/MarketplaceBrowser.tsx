'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchMarketIndex,
  importLibraryFromUrl,
  MARKET_BASE,
  type MarketLibraryEntry,
} from '@/utils/libraryImport';

interface Props {
  /** 导入成功后回调（上层切回"我的模板"视图并刷新）。 */
  onImported: (count: number) => void;
}

// 模块级缓存：抽屉反复开关不重复拉 229 条索引。
let indexCache: MarketLibraryEntry[] | null = null;

export function MarketplaceBrowser({ onImported }: Props): JSX.Element {
  const t = useTranslations('marketplace');
  const [entries, setEntries] = useState<MarketLibraryEntry[]>(indexCache ?? []);
  const [loading, setLoading] = useState(!indexCache);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (indexCache) return;
    setLoading(true);
    setError(false);
    void fetchMarketIndex()
      .then((list) => {
        indexCache = list;
        if (mounted.current) setEntries(list);
      })
      .catch(() => { if (mounted.current) setError(true); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.authors?.some((a) => a.name?.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const handleImport = async (entry: MarketLibraryEntry) => {
    if (importingId) return;
    setImportingId(entry.id);
    try {
      const n = await importLibraryFromUrl(`${MARKET_BASE}${entry.source}`);
      onImported(n);
    } finally {
      if (mounted.current) setImportingId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 搜索 */}
      <div style={{ padding: '8px 12px' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          style={{
            width: '100%',
            padding: '6px 9px',
            background: 'var(--paper)',
            border: '1.5px solid var(--ink)',
            borderRadius: 3,
            color: 'var(--ink)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            outline: 'none',
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 12px 14px' }}>
        {loading && (
          <div style={{ padding: '24px 6px', fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {t('loading')}
          </div>
        )}
        {error && (
          <div style={{ padding: '24px 6px', fontSize: 11.5, color: 'var(--rec)', fontFamily: 'var(--font-mono)' }}>
            {t('loadError')}
          </div>
        )}
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {filtered.map((entry, i) => {
              const busy = importingId === entry.id;
              return (
                <button
                  key={`${entry.source ?? entry.id ?? 'lib'}-${i}`}
                  type="button"
                  onClick={() => handleImport(entry)}
                  disabled={!!importingId}
                  title={entry.name}
                  className="group relative text-left"
                  style={{
                    background: 'var(--paper)',
                    border: '1.5px solid var(--ink)',
                    borderRadius: 3,
                    padding: 6,
                    cursor: importingId ? 'wait' : 'pointer',
                    opacity: importingId && !busy ? 0.5 : 1,
                  }}
                >
                  {entry.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${MARKET_BASE}${entry.preview}`}
                      alt={entry.name}
                      loading="lazy"
                      style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', display: 'block', background: '#fff' }}
                    />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4 / 3', background: 'var(--paper-2,#f3f3f0)' }} />
                  )}
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      lineHeight: 1.3,
                      color: 'var(--ink)',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {busy ? t('importing') : entry.name}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
