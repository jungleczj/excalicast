'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DEFAULT_VIDEO_BACKGROUND, VIDEO_BACKGROUND_PRESETS, type VideoBackgroundPreset } from '@/config/videoBackgrounds';
import { I } from '@/components/icons';
import type { ExportConfig, VideoBackgroundConfig, VideoBackgroundTone } from '@/types/recording';

interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
}

const TONES: VideoBackgroundTone[] = ['all', 'fresh', 'soft', 'dark', 'natural'];

export function VideoBackgroundPanel({ config, onChange }: Props): JSX.Element {
  const t = useTranslations('videoBackgroundPanel');
  const en = useLocale() === 'en';
  const value = config.videoBackground ?? DEFAULT_VIDEO_BACKGROUND;
  const [tone, setTone] = useState<VideoBackgroundTone>(() => value.tone ?? 'all');
  const filtered = VIDEO_BACKGROUND_PRESETS.filter((preset) => tone === 'all' || preset.tone === tone);

  const setValue = (next: VideoBackgroundConfig) => {
    onChange({ ...config, videoBackground: next });
  };

  return (
    <section
      className="space-y-3"
      style={{
        background: '#fffdf8',
        border: '1px solid rgba(24,25,26,0.08)',
        borderRadius: 24,
        padding: 18,
        boxShadow: '0 10px 28px rgba(48,38,26,0.06), inset 0 1px 0 rgba(255,255,255,0.76)',
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--ink)' }}>{t('title')}</div>
        <p style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
          {t('subtitle')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TONES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTone(item)}
            style={{
              padding: '5px 10px',
              borderRadius: 999,
              border: '1px solid rgba(31,34,37,.12)',
              background: tone === item ? 'var(--ink)' : 'var(--paper-2)',
              color: tone === item ? 'var(--paper)' : 'var(--ink-2)',
              fontSize: 10.5,
              fontWeight: 750,
              cursor: 'pointer',
            }}
          >
            {t(`tones.${item}`)}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
        <BackgroundOption
          label={t('none')}
          selected={value.kind === 'none'}
          onClick={() => setValue(DEFAULT_VIDEO_BACKGROUND)}
        />
        {filtered.map((preset) => (
          <BackgroundOption
            key={preset.id}
            preset={preset}
            label={en ? preset.labelEn : preset.labelZh}
            selected={value.kind === 'preset' && value.presetId === preset.id}
            onClick={() => setValue({ kind: 'preset', presetId: preset.id, tone: preset.tone })}
          />
        ))}
      </div>
    </section>
  );
}

function BackgroundOption({
  preset,
  label,
  selected,
  onClick,
}: {
  preset?: VideoBackgroundPreset;
  label: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="press"
      style={{
        padding: 0,
        borderRadius: 0,
        border: 'none',
        background: 'transparent',
        boxShadow: 'none',
        cursor: 'pointer',
        color: 'var(--ink)',
      }}
    >
      <div
        style={{
          aspectRatio: '16 / 9',
          width: '100%',
          borderRadius: 13,
          border: selected ? '2px solid var(--ink)' : '1px solid rgba(31,34,37,.09)',
          boxShadow: selected ? '0 0 0 3px rgba(255,253,248,.92), 0 10px 24px rgba(48,38,26,.12)' : '0 8px 18px rgba(48,38,26,.05)',
          background: preset ? `url(${preset.preview}) center / cover no-repeat` : 'linear-gradient(135deg, #fffdf8, #f4efe8)',
        }}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span style={{ fontSize: 11, fontWeight: 750 }}>{label}</span>
        {selected && <I.Check size={13} />}
      </div>
    </button>
  );
}
