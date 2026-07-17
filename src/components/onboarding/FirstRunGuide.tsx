'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';

/**
 * First-run onboarding overlay for /app. Shown once (parent gates via
 * localStorage). 3-step "how to record" + a "start from template" shortcut.
 * Sketch-minimalist, reuses design primitives. Dismiss via any action.
 */
export function FirstRunGuide({
  onClose,
  onStartFromTemplate,
}: {
  onClose: () => void;
  onStartFromTemplate: () => void;
}): JSX.Element {
  const t = useTranslations('appIntro');
  const steps = [t('step1'), t('step2'), t('step3')];
  return (
    <div className="app-craft-modal-overlay fade-in fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,26,26,0.35)' }} onClick={onClose}>
      <div
        className="app-craft-modal-card"
        style={{ width: '100%', maxWidth: 500, padding: 30, position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
          <div
            className="app-craft-message"
            style={{ display: 'inline-flex', padding: '6px 12px', fontSize: 13, color: 'rgba(24,25,26,0.68)', fontWeight: 650 }}
          >
            {t('welcome')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('skip')}
            className="app-craft-modal-close"
            style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, cursor: 'pointer', color: 'var(--ink-3)', display: 'grid', placeItems: 'center' }}
          >
            <I.Close size={18} />
          </button>

          <h2 className="app-craft-modal-title" style={{ marginTop: 14, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('title')}</h2>

          <ol style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'grid', gap: 14 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="app-craft-message" style={{ flexShrink: 0, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontFamily: 'var(--font-sans)', background: i === 1 ? 'var(--rec)' : 'var(--hi)', color: i === 1 ? '#fff' : 'var(--ink)', borderRadius: 999 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)', paddingTop: 2 }}>{s}</span>
              </li>
            ))}
          </ol>

          <div className="app-craft-message" style={{ marginTop: 18, padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: '#c28a00' }}>★</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{t('tipIsolation')}</span>
          </div>

          <div className="app-craft-modal-actions mt-6">
            <button type="button" className="app-craft-login" onClick={onClose}>
              <span className="rec-dot" style={{ width: 6, height: 6 }} /> {t('startDrawing')}
            </button>
            <button type="button" className="app-craft-secondary-button" onClick={onStartFromTemplate}>
              <I.Library size={14} /> {t('fromTemplate')}
            </button>
          </div>
      </div>
    </div>
  );
}
