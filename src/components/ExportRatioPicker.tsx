'use client';

import { useTranslations } from 'next-intl';
import { ASPECT_PRESETS, type AspectRatio, type CroppingMode, type ExportConfig } from '@/types/recording';

interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
}

// 与录制 Setup 一致的全部 10 个预设比例。
const RATIOS: AspectRatio[] = ['16:9', '4:3', '21:9', '16:10', '3:2', '9:16', '4:5', '3:4', '2:3', '1:1'];
const ORDER = (r: AspectRatio) => RATIOS.indexOf(r);

export function ExportRatioPicker({ config, onChange }: Props): JSX.Element {
  const t = useTranslations('ratioPicker');
  const keepZoomedIn = config.alwaysKeepZoomedIn ?? false;

  const MODES: { value: CroppingMode; label: string; hint: string }[] = [
    { value: 'follow_viewport', label: t('modes.followViewportLabel'), hint: t('modes.followViewportHint') },
    { value: 'fit_all_content', label: t('modes.fitAllLabel'),         hint: t('modes.fitAllHint') },
  ];

  const selected = config.exportRatios ?? [config.aspectRatio];
  const isSel = (r: AspectRatio) => selected.includes(r);
  // 点格子＝设为预览并加入导出集；× ＝从导出集移除（至少留 1）。
  const previewAndSelect = (r: AspectRatio) => {
    const next = isSel(r) ? selected : [...selected, r].sort((a, b) => ORDER(a) - ORDER(b));
    onChange({ ...config, aspectRatio: r, exportRatios: next });
  };
  const removeRatio = (r: AspectRatio) => {
    if (selected.length <= 1) return;
    const next = selected.filter((x) => x !== r);
    onChange({ ...config, exportRatios: next, aspectRatio: config.aspectRatio === r ? next[0] : config.aspectRatio });
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="label-mono" style={{ fontSize: 11 }}>{t('ratioHeading')}</h3>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
            {selected.length > 1 ? `× ${selected.length}` : t('ratioSubheading')}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {RATIOS.map((r) => {
            const preset = ASPECT_PRESETS[r];
            const sel = isSel(r);
            const preview = config.aspectRatio === r;
            const max = Math.max(preset.width, preset.height);
            return (
              <button
                key={r}
                type="button"
                onClick={() => previewAndSelect(r)}
                className="editor-craft-ratio-card press relative flex flex-col items-center justify-center gap-1.5"
                data-active={preview}
                data-selected={sel}
                title={preset.platforms}
                style={{
                  padding: '10px 6px',
                  background: preview ? 'var(--hi)' : sel ? 'var(--hi-soft)' : 'var(--paper)',
                  border: '1.5px solid var(--ink)',
                  borderRadius: 1,
                  boxShadow: preview ? '2px 2px 0 var(--ink)' : 'none',
                  color: 'var(--ink)',
                }}
              >
                {/* 复选框：点它切换选择（选中✓→取消，至少留 1；未选→加入并预览） */}
                <span
                  role="checkbox"
                  aria-checked={sel}
                  aria-label={r}
                  onClick={(e) => { e.stopPropagation(); if (sel) removeRatio(r); else previewAndSelect(r); }}
                  className="editor-craft-ratio-check absolute left-1 top-1 grid h-4 w-4 place-items-center"
                  style={{ background: sel ? 'var(--ink)' : 'var(--paper)', color: 'var(--paper)', border: '1.2px solid var(--ink)', borderRadius: 999, fontSize: 9, lineHeight: 1, cursor: 'pointer' }}
                >{sel ? '✓' : ''}</span>
                <div
                  className="editor-craft-ratio-shape"
                  style={{
                    width: 26 * (preset.width / max),
                    height: 26 * (preset.height / max),
                    minWidth: 7, minHeight: 7,
                    border: '1.4px solid var(--ink)',
                    background: preview ? 'var(--paper)' : 'var(--paper-2)',
                    borderRadius: 1,
                  }}
                />
                <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{r}</span>
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
                onClick={() => onChange({
                  ...config,
                  croppingMode: m.value,
                  alwaysKeepZoomedIn: m.value === 'follow_viewport',
                })}
                className="editor-craft-segment-card press flex w-full items-start gap-3 p-3 text-left"
                data-active={active}
                style={{
                  background: active ? 'var(--hi-soft)' : 'var(--paper)',
                  border: '1.4px solid var(--ink)',
                  borderRadius: 3,
                  boxShadow: active ? '2px 2px 0 var(--ink)' : 'none',
                }}
              >
                <span
                  className="editor-craft-radio-dot mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-full"
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

      <div
        className="flex items-center justify-between gap-4"
        style={{ borderTop: '1px solid rgba(31,34,37,.14)', paddingTop: 14 }}
      >
        <div className="min-w-0">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t('modes.keepZoomedLabel')}</div>
          <div style={{ marginTop: 2, fontSize: 11, lineHeight: 1.4, color: 'var(--ink-3)' }}>
            {t('modes.keepZoomedHint')}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={t('modes.keepZoomedLabel')}
          aria-checked={keepZoomedIn}
          onClick={() => {
            const next = !keepZoomedIn;
            onChange({
              ...config,
              alwaysKeepZoomedIn: next,
              croppingMode: next ? 'follow_viewport' : 'fit_all_content',
            });
          }}
          style={{
            position: 'relative',
            width: 42,
            height: 24,
            flexShrink: 0,
            border: '1.5px solid var(--ink)',
            borderRadius: 999,
            background: keepZoomedIn ? 'var(--ink)' : 'var(--paper-2)',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: keepZoomedIn ? 20 : 3,
              top: 3,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: keepZoomedIn ? 'var(--hi)' : 'var(--paper)',
              border: '1px solid var(--ink)',
              transition: 'left 140ms ease',
            }}
          />
        </button>
      </div>
    </div>
  );
}
