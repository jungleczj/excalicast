'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { RecordingsList } from '@/components/RecordingsList';
import { listRecordings } from '@/lib/db-client';
import type { RecordingMetadata } from '@/types/recording';
import { Link } from '@/i18n/navigation';

export default function LibraryPage(): JSX.Element {
  const t = useTranslations('library');
  const locale = useLocale();
  const [stats, setStats] = useState<{ count: number; totalMs: number }>({ count: 0, totalMs: 0 });

  useEffect(() => {
    listRecordings().then((list: RecordingMetadata[]) => {
      const totalMs = list.reduce((acc, m) => acc + m.durationMs, 0);
      setStats({ count: list.length, totalMs });
    }).catch(() => { /* ignore */ });
  }, []);

  const totalMin = Math.round(stats.totalMs / 60_000);
  const heading = locale === 'en' ? 'My recordings' : '我的录制';
  const subline = locale === 'en'
    ? `${stats.count} recording${stats.count === 1 ? '' : 's'} · ${totalMin} min total · all stored locally`
    : `${stats.count} 条录制 · 共 ${totalMin} 分钟 · 全部存于本机`;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <AppHeader tier="free" />

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h1 className="text-[22px] font-bold leading-tight">{heading}</h1>
              <div className="mt-1 text-[13px] text-text-secondary">{subline}</div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/app"
                className="flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold text-white"
                style={{ background: 'var(--recording-strong)', boxShadow: '0 4px 12px rgba(220,38,38,0.25)' }}
              >
                <span className="h-2 w-2 rounded-full bg-white" />
                {t('newRecording')}
              </Link>
            </div>
          </div>

          <RecordingsList />
        </div>
      </div>
    </div>
  );
}
