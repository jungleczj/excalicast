'use client';

import { useTranslations } from 'next-intl';
import { ASPECT_PRESETS, type AspectRatio, type CroppingMode, type ExportConfig } from '@/types/recording';

interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
}

const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

export function ExportRatioPicker({ config, onChange }: Props): JSX.Element {
  const t = useTranslations('ratioPicker');

  const MODES: { value: CroppingMode; label: string; hint: string }[] = [
    { value: 'follow_viewport', label: t('modes.followViewportLabel'), hint: t('modes.followViewportHint') },
    { value: 'fit_all_content', label: t('modes.fitAllLabel'),         hint: t('modes.fitAllHint') },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="label-mono" style={{ fontSize: 11 }}>{t('ratioHeading')}</h3>
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' }}
          >
            {t('ratioSubheading')}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {RATIOS.map((r) => {
            const preset = ASPECT_PRESETS[r];
            const active = config.aspectRatio === r;
            const max = Math.max(preset.width, preset.height);
            return (
              <button
                key={r}
                type="button"
                onClick={() => onChange({ ...config, aspectRatio: r })}
                className="press flex flex-col items-center justify-center gap-1.5"
                style={{
                  padding: '10px 8px',
                  background: active ? 'var(--hi)' : 'var(--paper)',
                  border: '1.5px solid var(--ink)',
                  borderRadius: 3,
                  boxShadow: active ? '2px 2px 0 var(--ink)' : 'none',
                  color: 'var(--ink)',
                }}
              >
                <div
                  style={{
                    width: 28 * (preset.width / max),
                    height: 28 * (preset.height / max),
                    minWidth: 8,
                    minHeight: 8,
                    border: '1.4px solid var(--ink)',
                    background: active ? 'var(--paper)' : 'var(--paper-2)',
                    borderRadius: 1,
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{r}</span>
                <span
                  style={{ fontSize: 9, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
                >
                  {t(`ratioHints.${r}` as never)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="label-mono mb-3" style={{ fontSize: 11 }}>{t('modeHeading')}</h3>
        <div className="space-y-2">
          {MODES.map((m) => {
            const active = config.croppingMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onChange({ ...config, croppingMode: m.value })}
                className="press flex w-full items-start gap-3 p-3 text-left"
                style={{
                  background: active ? 'var(--hi-soft)' : 'var(--paper)',
                  border: '1.4px solid var(--ink)',
                  borderRadius: 3,
                  boxShadow: active ? '2px 2px 0 var(--ink)' : 'none',
                }}
              >
                <span
                  className="mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-full"
                  style={{
                    border: '1.6px solid var(--ink)',
                    background: 'var(--paper)',
                  }}
                >
                  {active && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--ink)' }} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.label}</div>
                  <div className="mt-0.5" style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                    {m.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
