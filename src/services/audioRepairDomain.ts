export type AudioRepairPreset = 'natural' | 'clear' | 'studio';
export type AudioRepairSeverity = 'none' | 'low' | 'medium' | 'high';

export interface AudioRepairToggles {
  hiss: boolean;
  clicks: boolean;
  clipping: boolean;
  hum: boolean;
  sibilance: boolean;
}

export interface AudioRepairSettings {
  preset: AudioRepairPreset;
  repairStrength: number;
  clarity: number;
  warmth: number;
  originalMix: number;
  repairs: AudioRepairToggles;
}

export interface AudioRepairMetrics {
  highFrequencyRatio: number;
  clickRate: number;
  clippedRatio: number;
  humRatio: number;
}

export interface AudioRepairDiagnosis {
  hiss: AudioRepairSeverity;
  clicks: AudioRepairSeverity;
  clipping: AudioRepairSeverity;
  hum: AudioRepairSeverity;
}

export const AUDIO_REPAIR_PRESETS: Record<AudioRepairPreset, AudioRepairSettings> = {
  natural: {
    preset: 'natural', repairStrength: 38, clarity: 32, warmth: 42, originalMix: 72,
    repairs: { hiss: true, clicks: true, clipping: true, hum: false, sibilance: true },
  },
  clear: {
    preset: 'clear', repairStrength: 58, clarity: 70, warmth: 30, originalMix: 48,
    repairs: { hiss: true, clicks: true, clipping: true, hum: true, sibilance: true },
  },
  studio: {
    preset: 'studio', repairStrength: 78, clarity: 62, warmth: 56, originalMix: 32,
    repairs: { hiss: true, clicks: true, clipping: true, hum: true, sibilance: true },
  },
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));

export function normalizeAudioRepairSettings(settings: AudioRepairSettings): AudioRepairSettings {
  return {
    preset: settings.preset in AUDIO_REPAIR_PRESETS ? settings.preset : 'natural',
    repairStrength: clampPercent(settings.repairStrength),
    clarity: clampPercent(settings.clarity),
    warmth: clampPercent(settings.warmth),
    originalMix: clampPercent(settings.originalMix),
    repairs: {
      hiss: !!settings.repairs.hiss,
      clicks: !!settings.repairs.clicks,
      clipping: !!settings.repairs.clipping,
      hum: !!settings.repairs.hum,
      sibilance: !!settings.repairs.sibilance,
    },
  };
}

export function audioRepairSettingsFingerprint(settings: AudioRepairSettings): string {
  const value = normalizeAudioRepairSettings(settings);
  return [
    value.preset, value.repairStrength, value.clarity, value.warmth, value.originalMix,
    value.repairs.hiss, value.repairs.clicks, value.repairs.clipping, value.repairs.hum, value.repairs.sibilance,
  ].map(String).join(':');
}

function severity(value: number, thresholds: readonly [number, number, number]): AudioRepairSeverity {
  if (value >= thresholds[2]) return 'high';
  if (value >= thresholds[1]) return 'medium';
  if (value >= thresholds[0]) return 'low';
  return 'none';
}

export function summarizeAudioRepairDiagnosis(metrics: AudioRepairMetrics): AudioRepairDiagnosis {
  return {
    hiss: severity(metrics.highFrequencyRatio, [0.06, 0.14, 0.28]),
    clicks: severity(metrics.clickRate, [0.001, 0.004, 0.007]),
    clipping: severity(metrics.clippedRatio, [0.002, 0.008, 0.025]),
    hum: severity(metrics.humRatio, [0.04, 0.1, 0.22]),
  };
}
