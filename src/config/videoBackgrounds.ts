import type { VideoBackgroundConfig, VideoBackgroundTone } from '@/types/recording';

export interface VideoBackgroundPreset {
  id: string;
  tone: Exclude<VideoBackgroundTone, 'all'>;
  labelZh: string;
  labelEn: string;
  asset: string;
  preview: string;
}

export const DEFAULT_VIDEO_BACKGROUND: VideoBackgroundConfig = {
  kind: 'none',
};

export const VIDEO_BACKGROUND_PRESETS: VideoBackgroundPreset[] = [
  {
    id: 'paper-sky',
    tone: 'fresh',
    labelZh: '纸感蓝',
    labelEn: 'Paper sky',
    asset: '/video-backgrounds/paper-sky.svg',
    preview: '/video-backgrounds/paper-sky.svg',
  },
  {
    id: 'soft-mint',
    tone: 'soft',
    labelZh: '柔和绿',
    labelEn: 'Soft mint',
    asset: '/video-backgrounds/soft-mint.svg',
    preview: '/video-backgrounds/soft-mint.svg',
  },
  {
    id: 'warm-yellow',
    tone: 'natural',
    labelZh: '暖黄纸',
    labelEn: 'Warm paper',
    asset: '/video-backgrounds/warm-yellow.svg',
    preview: '/video-backgrounds/warm-yellow.svg',
  },
  {
    id: 'lavender-note',
    tone: 'soft',
    labelZh: '淡紫便笺',
    labelEn: 'Lavender note',
    asset: '/video-backgrounds/lavender-note.svg',
    preview: '/video-backgrounds/lavender-note.svg',
  },
  {
    id: 'charcoal-paper',
    tone: 'dark',
    labelZh: '深色纸面',
    labelEn: 'Charcoal paper',
    asset: '/video-backgrounds/charcoal-paper.svg',
    preview: '/video-backgrounds/charcoal-paper.svg',
  },
];

export function resolveVideoBackground(
  config?: VideoBackgroundConfig,
): VideoBackgroundConfig {
  if (!config || config.kind === 'none') return DEFAULT_VIDEO_BACKGROUND;
  const preset = VIDEO_BACKGROUND_PRESETS.find((item) => item.id === config.presetId);
  if (!preset) return DEFAULT_VIDEO_BACKGROUND;
  return {
    kind: 'preset',
    presetId: preset.id,
    tone: preset.tone,
    blurPx: Math.max(0, Math.min(40, config.blurPx ?? 0)),
    dim: Math.max(0, Math.min(1, config.dim ?? 0)),
  };
}

export function getVideoBackgroundPreset(presetId?: string): VideoBackgroundPreset | null {
  if (!presetId) return null;
  return VIDEO_BACKGROUND_PRESETS.find((item) => item.id === presetId) ?? null;
}
