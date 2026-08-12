import { expect, test } from '@playwright/test';
import {
  AUDIO_REPAIR_PRESETS,
  audioRepairSettingsFingerprint,
  normalizeAudioRepairSettings,
  summarizeAudioRepairDiagnosis,
} from '@/services/audioRepairDomain';

test('audio repair presets preserve voice while increasing repair intensity', () => {
  expect(AUDIO_REPAIR_PRESETS.natural.originalMix).toBeGreaterThan(AUDIO_REPAIR_PRESETS.clear.originalMix);
  expect(AUDIO_REPAIR_PRESETS.clear.clarity).toBeGreaterThan(AUDIO_REPAIR_PRESETS.natural.clarity);
  expect(AUDIO_REPAIR_PRESETS.studio.repairStrength).toBeGreaterThan(AUDIO_REPAIR_PRESETS.clear.repairStrength);
});

test('audio repair settings are clamped and normalized before processing', () => {
  const normalized = normalizeAudioRepairSettings({
    preset: 'clear',
    repairStrength: 180,
    clarity: -12,
    warmth: 44.4,
    originalMix: 101,
    repairs: { hiss: true, clicks: false, clipping: true, hum: true, sibilance: false },
  });

  expect(normalized).toEqual({
    preset: 'clear',
    repairStrength: 100,
    clarity: 0,
    warmth: 44,
    originalMix: 100,
    repairs: { hiss: true, clicks: false, clipping: true, hum: true, sibilance: false },
  });
});

test('audio repair cache fingerprint changes with audible settings', () => {
  const base = normalizeAudioRepairSettings(AUDIO_REPAIR_PRESETS.natural);
  expect(audioRepairSettingsFingerprint(base)).toBe(audioRepairSettingsFingerprint({ ...base }));
  expect(audioRepairSettingsFingerprint(base)).not.toBe(audioRepairSettingsFingerprint({ ...base, clarity: base.clarity + 1 }));
  expect(audioRepairSettingsFingerprint(base)).not.toBe(audioRepairSettingsFingerprint({
    ...base,
    repairs: { ...base.repairs, clicks: !base.repairs.clicks },
  }));
});

test('audio diagnosis produces stable severity labels', () => {
  expect(summarizeAudioRepairDiagnosis({ highFrequencyRatio: 0.19, clickRate: 0.008, clippedRatio: 0.004, humRatio: 0.12 })).toEqual({
    hiss: 'medium',
    clicks: 'high',
    clipping: 'low',
    hum: 'medium',
  });
});
