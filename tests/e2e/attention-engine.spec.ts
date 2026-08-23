import { expect, test } from '@playwright/test';

import {
  ATTENTION_WEIGHTS_V1,
  buildAttentionTimeline,
  type AttentionObservation,
} from '../../src/desktop/attentionEngine';

function observation(
  id: string,
  atMs: number,
  roiId: string,
  features: Partial<AttentionObservation['features']>,
): AttentionObservation {
  return {
    id,
    sceneId: 'scene-1',
    roiId,
    atMs,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    features: {
      inkActivity: 0,
      speechReference: 0,
      clickDwell: 0,
      objectSalience: 0,
      windowFocus: 1,
      recency: 0,
      motionNoise: 0,
      uiControlPenalty: 0,
      ...features,
    },
  };
}

test('attention weights prioritize deterministic teaching signals and penalize UI noise', () => {
  expect(ATTENTION_WEIGHTS_V1.inkActivity).toBeGreaterThan(ATTENTION_WEIGHTS_V1.objectSalience);
  expect(ATTENTION_WEIGHTS_V1.speechReference).toBeGreaterThan(ATTENTION_WEIGHTS_V1.recency);
  expect(ATTENTION_WEIGHTS_V1.motionNoise).toBeLessThan(0);
  expect(ATTENTION_WEIGHTS_V1.uiControlPenalty).toBeLessThan(0);
});

test('ink plus grounded speech wins over a transient click and UI controls', () => {
  const timeline = buildAttentionTimeline({
    sourceRecordingId: 'attention-lesson',
    durationMs: 8_000,
    observations: [
      observation('ink', 1_000, 'formula', { inkActivity: 0.9, speechReference: 0.95, recency: 0.8 }),
      observation('menu', 1_000, 'toolbar', { clickDwell: 1, objectSalience: 0.7, uiControlPenalty: 1, motionNoise: 0.7 }),
    ],
  });

  expect(timeline.windows).toHaveLength(1);
  expect(timeline.windows[0].primaryRoiId).toBe('formula');
  expect(timeline.windows[0].candidates[0].score).toBeGreaterThan(timeline.windows[0].candidates[1].score);
});

test('ambiguous weak candidates preserve full context instead of forcing a focus', () => {
  const timeline = buildAttentionTimeline({
    sourceRecordingId: 'attention-ambiguous',
    durationMs: 8_000,
    observations: [
      observation('left', 2_000, 'left', { objectSalience: 0.3 }),
      observation('right', 2_000, 'right', { objectSalience: 0.29 }),
    ],
  });

  expect(timeline.windows[0]).toMatchObject({ primaryRoiId: null, confidence: 0 });
});

test('new scenes remain separate and normalized input produces a byte-stable timeline', () => {
  const observations: AttentionObservation[] = [
    { ...observation('second', 4_000, 'chart', { clickDwell: 0.9, speechReference: 0.8 }), sceneId: 'scene-2' },
    observation('first', 500, 'intro', { inkActivity: 0.8, speechReference: 0.7 }),
  ];
  const input = { sourceRecordingId: 'stable-attention', durationMs: 10_000, observations };
  const first = buildAttentionTimeline(input);
  const second = buildAttentionTimeline(structuredClone(input));

  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first).toMatchObject({ schemaVersion: 1, engineVersion: 'attention-v1' });
  expect(first.windows.map((window) => window.sceneId)).toEqual(['scene-1', 'scene-2']);
});
