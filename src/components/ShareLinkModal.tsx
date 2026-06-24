'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { Modal } from '@/components/ui';

interface Props {
  open: boolean;
  url: string;
  expiresAt: number;
  onClose: () => void;
}

export function ShareLinkModal({ open, url, expiresAt, onClose }: Props): JSX.Element | null {
  const t = useTranslations('exportPanel');
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const expiry = new Date(expiresAt).toLocaleDateString();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <Modal open={open} onClose={onClose} width={500} hideClose>
        <div
          style={{
            padding: 24,
            background: 'var(--max)',
            borderBottom: '1.6px solid var(--ink)',
            position: 'relative',
          }}
        >
          <div className="flex items-start justify-between">
            <span className="tag-mono tag-mono-max">MAX · SHARE LINK</span>
            <button
              onClick={onClose}
              className="grid place-items-center"
              style={{
                width: 30, height: 30,
                border: '1.4px solid var(--ink)',
                background: 'var(--paper)',
                borderRadius: 3, color: 'var(--ink)', cursor: 'pointer',
              }}
              aria-label="close"
            >
              <I.Close size={13} />
            </button>
          </div>
          <h2 className="mt-4" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>
            {t('shareModalTitle')}
          </h2>
        </div>

        <div className="p-6">
          <div
            className="flex items-center gap-2 p-3"
            style={{
              background: 'var(--paper-2)',
              border: '1.4px solid var(--ink)',
              borderRadius: 3,
            }}
          >
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 bg-transparent outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--ink)',
                border: 'none',
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="btn-sketch btn-sketch-hi"
              style={{ padding: '6px 12px', fontSize: 10.5 }}
            >
              {copied ? t('shareCopied') : t('shareCopy')}
            </button>
          </div>
          <p
            className="mt-3"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            {t('shareExpires', { date: expiry })}
          </p>

          <button
            onClick={onClose}
            className="btn-sketch mt-5 w-full"
            style={{ justifyContent: 'center' }}
          >
            {t('shareClose')}
          </button>
        </div>
    </Modal>
  );
}
