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
      <div
        className="px-3 py-2.5"
        style={{
          background: 'var(--paper)',
          border: '1.4px solid var(--ink)',
          borderRadius: 3,
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <div className="flex items-center gap-2">
          <I.Square size={14} />
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{t('title')}</span>
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
      className="press w-full px-3 py-2.5 text-left"
      style={{
        background: checked ? 'var(--hi)' : 'var(--paper)',
        border: '1.5px solid var(--ink)',
        borderRadius: 3,
        boxShadow: checked ? '2px 2px 0 var(--ink)' : 'none',
        color: 'var(--ink)',
        fontSize: 12,
      }}
    >
      <div className="flex items-center gap-2">
        {checked ? <I.CheckSquare size={14} /> : <I.Square size={14} />}
        <span style={{ fontWeight: 700 }}>{t('title')}</span>
        <span
          className="ml-auto"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
          }}
        >
          {count}
        </span>
      </div>
      <div
        className="mt-1 ml-6"
        style={{ fontSize: 11, color: checked ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.4 }}
      >
        {t('lede')}
      </div>
      {checked && size && (
        <div
          className="mt-1 ml-6"
          style={{ fontSize: 10.5, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}
        >
          {t('lockedNote', { w: size.width, h: size.height })}
        </div>
      )}
    </button>
  );
}
