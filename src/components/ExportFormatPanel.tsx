'use client';

import type { JSX } from 'react';
import {
  ASPECT_PRESETS,
  RESOLUTION_SCALE,
  type ExportConfig,
  type ExportFormat,
  type ExportQuality,
  type ExportResolution,
} from '@/types/recording';

interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
  en: boolean;
}

const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const RES_NAME: Record<ExportResolution, { zh: string; en: string }> = {
  sd: { zh: '标清 480p', en: 'SD 480p' },
  hd: { zh: '高清 720p', en: 'HD 720p' },
  fhd: { zh: '全高清 1080p', en: 'Full HD 1080p' },
  qhd: { zh: '2K 1440p', en: '2K 1440p' },
  uhd: { zh: '4K 2160p', en: '4K 2160p' },
};
const RES_ORDER: ExportResolution[] = ['sd', 'hd', 'fhd', 'qhd', 'uhd'];

const FORMAT_LABEL: Record<ExportFormat, { zh: string; en: string }> = {
  mp4: { zh: 'MP4 · H.264', en: 'MP4 · H.264' },
  webm: { zh: 'WebM · VP9', en: 'WebM · VP9' },
  gif: { zh: 'GIF · 循环(无声)', en: 'GIF · loop (no audio)' },
};
const FPS_OPTIONS = [60, 30, 24, 15];
const QUALITY_LABEL: Record<ExportQuality, { zh: string; en: string }> = {
  auto: { zh: '自动', en: 'Auto' },
  high: { zh: '高', en: 'High' },
  medium: { zh: '中', en: 'Medium' },
  low: { zh: '低', en: 'Low' },
};

/** 导出「格式与清晰度」面板（对标设计 editor.jsx Format & resolution）。 */
export function ExportFormatPanel({ config, onChange, en }: Props): JSX.Element {
  const preset = ASPECT_PRESETS[config.aspectRatio];
  const resolution = config.resolution ?? 'fhd';
  const format = config.format ?? 'mp4';
  const quality = config.quality ?? 'auto';
  const dims = (r: ExportResolution) =>
    `${evenize(preset.width * RESOLUTION_SCALE[r])}×${evenize(preset.height * RESOLUTION_SCALE[r])}`;

  return (
    <div>
      <h3 className="label-mono mb-3" style={{ fontSize: 11 }}>{en ? 'Format & resolution' : '格式与清晰度'}</h3>
      <div className="space-y-2">
        <Row label={en ? 'Resolution' : '清晰度'} value={resolution} onChange={(v) => onChange({ ...config, resolution: v as ExportResolution })}
          options={RES_ORDER.map((r) => ({ value: r, label: `${en ? RES_NAME[r].en : RES_NAME[r].zh} · ${dims(r)}` }))} />
        <Row label={en ? 'Format' : '格式'} value={format} onChange={(v) => onChange({ ...config, format: v as ExportFormat })}
          options={(['mp4', 'webm', 'gif'] as ExportFormat[]).map((f) => ({ value: f, label: en ? FORMAT_LABEL[f].en : FORMAT_LABEL[f].zh }))} />
        <Row label={en ? 'Frame rate' : '帧率'} value={String(config.fps)} onChange={(v) => onChange({ ...config, fps: Number(v) })}
          options={FPS_OPTIONS.map((f) => ({ value: String(f), label: `${f} fps` }))} />
        <Row label={en ? 'Quality' : '画质码率'} value={quality} onChange={(v) => onChange({ ...config, quality: v as ExportQuality })}
          options={(['auto', 'high', 'medium', 'low'] as ExportQuality[]).map((q) => ({ value: q, label: en ? QUALITY_LABEL[q].en : QUALITY_LABEL[q].zh }))} />
      </div>
      {format === 'gif' && (
        <p className="mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-3)' }}>
          {en ? 'GIF: no audio, larger files, slower render.' : 'GIF：无音轨、文件较大、渲染较慢。'}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}): JSX.Element {
  return (
    <div className="flex items-center justify-between" style={{ padding: '6px 12px 6px 14px', border: '1.3px solid var(--ink)', borderRadius: 3, background: 'var(--paper)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)', fontWeight: 600 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="press"
        style={{ minWidth: 170, padding: '4px 10px', background: 'var(--paper-2)', border: '1.2px solid var(--ink)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
