'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { SketchCard, TapeLabel, MonoTag } from '@/components/ui';

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
    <div className="fade-in fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,26,26,0.35)' }} onClick={onClose}>
      <SketchCard hover={false} accent style={{ width: '100%', maxWidth: 460, padding: 28, position: 'relative' }}>
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ position: 'absolute', top: -16, left: 22 }}>
            <TapeLabel rotate={-3}>{t('welcome')}</TapeLabel>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('skip')}
            style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}
          >
            <I.Close size={18} />
          </button>

          <h2 style={{ marginTop: 8, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('title')}</h2>

          <ol style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'grid', gap: 14 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontFamily: 'var(--font-display)', background: i === 1 ? 'var(--rec)' : 'var(--hi)', color: i === 1 ? '#fff' : 'var(--ink)', border: '1.6px solid var(--ink)', borderRadius: 8 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-2)', paddingTop: 2 }}>{s}</span>
              </li>
            ))}
          </ol>

          <div style={{ marginTop: 18, padding: '10px 12px', background: 'var(--hi-soft)', border: '1.4px dashed var(--ink)', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <MonoTag variant="hi">★</MonoTag>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{t('tipIsolation')}</span>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-sketch btn-sketch-primary btn-stamp" onClick={onClose}>
              <span className="rec-dot" style={{ width: 6, height: 6 }} /> {t('startDrawing')}
            </button>
            <button type="button" className="btn-sketch btn-stamp" onClick={onStartFromTemplate}>
              <I.Library size={14} /> {t('fromTemplate')}
            </button>
          </div>
        </div>
      </SketchCard>
    </div>
  );
}
