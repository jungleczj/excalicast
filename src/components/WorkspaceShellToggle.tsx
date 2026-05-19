'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { countWorkspaceShells, getWorkspaceShells } from '@/lib/db-client';
import { I } from '@/components/icons';
import type { ExportConfig } from '@/types/recording';

interface Props {
  recordingId: string;
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
}

export function WorkspaceShellToggle({ recordingId, config, onChange }: Props): JSX.Element | null {
  const t = useTranslations('workspaceShell');
  const [count, setCount] = useState<number | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const c = await countWorkspaceShells(recordingId);
      if (cancelled) return;
      setCount(c);
      if (c > 0) {
        const shells = await getWorkspaceShells(recordingId);
        if (!cancelled && shells.length > 0) {
          setSize(shells[0].shellSize);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [recordingId]);

  if (count === null) return null; // 加载中
  if (count === 0) {
    return (
      <div className="rounded-md border border-border-default bg-bg-secondary px-3 py-2.5 text-[11px] text-text-tertiary">
        <div className="flex items-center gap-2">
          <I.Square size={14} />
          <span className="font-semibold text-text-secondary">{t('title')}</span>
        </div>
        <div className="mt-1 ml-6">{t('notAvailable')}</div>
      </div>
    );
  }

  const checked = config.includeWorkspaceShell ?? true;
  return (
    <button
      type="button"
      onClick={() => onChange({ ...config, includeWorkspaceShell: !checked })}
      className={`w-full rounded-md border px-3 py-2.5 text-left text-[12px] transition ${
        checked
          ? 'border-primary-300 bg-primary-50'
          : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
      }`}
    >
      <div className="flex items-center gap-2">
        {checked ? (
          <I.CheckSquare size={14} className="text-primary-600" />
        ) : (
          <I.Square size={14} />
        )}
        <span className="font-semibold text-text-primary">{t('title')}</span>
        <span className="ml-auto text-[10px] text-text-tertiary">{count} {/* shells */}</span>
      </div>
      <div className="mt-1 ml-6 text-[11px] text-text-secondary">
        {t('lede')}
      </div>
      {checked && size && (
        <div className="mt-1 ml-6 text-[10.5px] text-primary-700">
          {t('lockedNote', { w: size.width, h: size.height })}
        </div>
      )}
    </button>
  );
}
