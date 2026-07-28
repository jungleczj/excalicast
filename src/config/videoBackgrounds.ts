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
    id: 'coral-silk',
    tone: 'fresh',
    labelZh: '珊瑚丝光',
    labelEn: 'Coral silk',
    asset: '/video-backgrounds/coral-silk.png',
    preview: '/video-backgrounds/coral-silk.png',
  },
  {
    id: 'botanical-frame',
    tone: 'natural',
    labelZh: '花叶留白',
    labelEn: 'Botanical frame',
    asset: '/video-backgrounds/botanical-frame.png',
    preview: '/video-backgrounds/botanical-frame.png',
  },
  {
    id: 'dawn-alpine',
    tone: 'natural',
    labelZh: '晨光雪岭',
    labelEn: 'Dawn alpine',
    asset: '/video-backgrounds/dawn-alpine.png',
    preview: '/video-backgrounds/dawn-alpine.png',
  },
  {
    id: 'indigo-aurora',
    tone: 'dark',
    labelZh: '靛紫极光',
    labelEn: 'Indigo aurora',
    asset: '/video-backgrounds/indigo-aurora.png',
    preview: '/video-backgrounds/indigo-aurora.png',
  },
  {
    id: 'paper-horizon',
    tone: 'soft',
    labelZh: '纸艺天际',
    labelEn: 'Paper horizon',
    asset: '/video-backgrounds/paper-horizon.png',
    preview: '/video-backgrounds/paper-horizon.png',
  },
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
  {
    id: 'candy-flow',
    tone: 'fresh',
    labelZh: '糖果流光',
    labelEn: 'Candy flow',
    asset: '/video-backgrounds/candy-flow.svg',
    preview: '/video-backgrounds/candy-flow.svg',
  },
  {
    id: 'blush-garden',
    tone: 'natural',
    labelZh: '柔粉花园',
    labelEn: 'Blush garden',
    asset: '/video-backgrounds/blush-garden.svg',
    preview: '/video-backgrounds/blush-garden.svg',
  },
  {
    id: 'pastel-haze',
    tone: 'soft',
    labelZh: '粉彩薄雾',
    labelEn: 'Pastel haze',
    asset: '/video-backgrounds/pastel-haze.svg',
    preview: '/video-backgrounds/pastel-haze.svg',
  },
  {
    id: 'aurora-snow',
    tone: 'dark',
    labelZh: '极光雪原',
    labelEn: 'Aurora snow',
    asset: '/video-backgrounds/aurora-snow.svg',
    preview: '/video-backgrounds/aurora-snow.svg',
  },
  {
    id: 'dawn-mountain',
    tone: 'natural',
    labelZh: '晨色山脊',
    labelEn: 'Dawn mountain',
    asset: '/video-backgrounds/dawn-mountain.svg',
    preview: '/video-backgrounds/dawn-mountain.svg',
  },
  {
    id: 'leaf-paper',
    tone: 'natural',
    labelZh: '叶影纸面',
    labelEn: 'Leaf paper',
    asset: '/video-backgrounds/leaf-paper.svg',
    preview: '/video-backgrounds/leaf-paper.svg',
  },
  {
    id: 'neon-dusk',
    tone: 'dark',
    labelZh: '霓虹暮色',
    labelEn: 'Neon dusk',
    asset: '/video-backgrounds/neon-dusk.svg',
    preview: '/video-backgrounds/neon-dusk.svg',
  },
];

export function resolveVideoBackground(
  config?: VideoBackgroundConfig,
): VideoBackgroundConfig {
  if (!config || config.kind === 'none') return DEFAULT_VIDEO_BACKGROUND;
  if (config.kind === 'color') {
    const color = /^#[0-9a-f]{6}$/i.test(config.color ?? '') ? config.color : '#fffdf8';
    return { kind: 'color', color };
  }
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
