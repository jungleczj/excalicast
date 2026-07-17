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
    <Modal open={open} onClose={onClose} width={620} hideClose>
        <div className="share-modal-craft">
          <button
            onClick={onClose}
            className="app-craft-modal-close commerce-craft-close grid place-items-center"
            aria-label="close"
          >
            <I.Close size={14} />
          </button>

          <div className="share-modal-craft-header">
            <span className="commerce-craft-badge is-share">Share link</span>
            <div className="commerce-craft-icon is-share">
              <I.Cloud size={28} sw={1.7} />
            </div>
            <h2 className="app-craft-modal-title commerce-craft-title">{t('shareModalTitle')}</h2>
            <p className="commerce-craft-subtitle">{t('shareExpires', { date: expiry })}</p>
          </div>

          <div className="share-modal-craft-body">
          <div className="share-modal-craft-link">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 bg-transparent outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="app-craft-secondary-button"
            >
              {copied ? t('shareCopied') : t('shareCopy')}
            </button>
          </div>

          <button
            onClick={onClose}
            className="app-craft-secondary-button share-modal-craft-close-button"
          >
            {t('shareClose')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
