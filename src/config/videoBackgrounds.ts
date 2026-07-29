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
    id: 'cyanotype-garden',
    tone: 'dark',
    labelZh: '蓝晒植物',
    labelEn: 'Cyanotype garden',
    asset: '/video-backgrounds/curated/bg-01-cyanotype-garden.png',
    preview: '/video-backgrounds/curated/bg-01-cyanotype-garden.png',
  },
  {
    id: 'mediterranean-window',
    tone: 'natural',
    labelZh: '地中海窗影',
    labelEn: 'Mediterranean window',
    asset: '/video-backgrounds/curated/bg-02-mediterranean-window.png',
    preview: '/video-backgrounds/curated/bg-02-mediterranean-window.png',
  },
  {
    id: 'mist-ridge-sunrise',
    tone: 'natural',
    labelZh: '雾岭晨曦',
    labelEn: 'Mist ridge sunrise',
    asset: '/video-backgrounds/curated/bg-03-mist-ridge-sunrise.png',
    preview: '/video-backgrounds/curated/bg-03-mist-ridge-sunrise.png',
  },
  {
    id: 'moonlit-water',
    tone: 'dark',
    labelZh: '月光水纹',
    labelEn: 'Moonlit water',
    asset: '/video-backgrounds/curated/bg-05-moonlit-water.png',
    preview: '/video-backgrounds/curated/bg-05-moonlit-water.png',
  },
  {
    id: 'terracotta-arcade',
    tone: 'natural',
    labelZh: '赤陶拱廊',
    labelEn: 'Terracotta arcade',
    asset: '/video-backgrounds/curated/bg-06-terracotta-arcade.png',
    preview: '/video-backgrounds/curated/bg-06-terracotta-arcade.png',
  },
  {
    id: 'polar-glow',
    tone: 'soft',
    labelZh: '极地柔光',
    labelEn: 'Polar glow',
    asset: '/video-backgrounds/curated/bg-07-polar-glow.png',
    preview: '/video-backgrounds/curated/bg-07-polar-glow.png',
  },
  {
    id: 'desert-afterglow',
    tone: 'dark',
    labelZh: '沙丘暮色',
    labelEn: 'Desert afterglow',
    asset: '/video-backgrounds/curated/bg-09-desert-afterglow.png',
    preview: '/video-backgrounds/curated/bg-09-desert-afterglow.png',
  },
  {
    id: 'celestial-relief',
    tone: 'dark',
    labelZh: '星图浮雕',
    labelEn: 'Celestial relief',
    asset: '/video-backgrounds/curated/bg-11-celestial-relief.png',
    preview: '/video-backgrounds/curated/bg-11-celestial-relief.png',
  },
  {
    id: 'mineral-veil',
    tone: 'soft',
    labelZh: '矿物薄雾',
    labelEn: 'Mineral veil',
    asset: '/video-backgrounds/curated/bg-13-mineral-veil.png',
    preview: '/video-backgrounds/curated/bg-13-mineral-veil.png',
  },
  {
    id: 'washi-horizon',
    tone: 'natural',
    labelZh: '和纸远山',
    labelEn: 'Washi horizon',
    asset: '/video-backgrounds/curated/bg-14-washi-horizon.png',
    preview: '/video-backgrounds/curated/bg-14-washi-horizon.png',
  },
  {
    id: 'shallow-sea-light',
    tone: 'fresh',
    labelZh: '浅海日光',
    labelEn: 'Shallow sea light',
    asset: '/video-backgrounds/curated/bg-15-shallow-sea-light.png',
    preview: '/video-backgrounds/curated/bg-15-shallow-sea-light.png',
  },
  {
    id: 'tideglaze-scales',
    tone: 'fresh',
    labelZh: '潮汐细鳞',
    labelEn: 'Tideglaze scales',
    asset: '/video-backgrounds/curated/bg-17-tideglaze-scales.png',
    preview: '/video-backgrounds/curated/bg-17-tideglaze-scales.png',
  },
  {
    id: 'dense-floral-weave',
    tone: 'natural',
    labelZh: '细密花织',
    labelEn: 'Dense floral weave',
    asset: '/video-backgrounds/curated/bg-18-dense-floral-weave.png',
    preview: '/video-backgrounds/curated/bg-18-dense-floral-weave.png',
  },
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
