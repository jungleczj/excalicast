import { expect, test } from '@playwright/test';
import { focusPointAt, focusedCoverPlacement } from '../../src/services/cursorFocusTracker';
import type { CursorFocusTrack } from '../../src/types/recording';

const track: CursorFocusTrack = {
  recordingId: 'cursor-focus-fixture',
  detectorVersion: 1,
  sourceSignature: 'fixture',
  analyzedAt: 1,
  quality: 'good',
  samples: [
    { timestamp: 0, x: 0.1, y: 0.2, confidence: 0.9 },
    { timestamp: 1_000, x: 0.9, y: 0.8, confidence: 0.9 },
  ],
};

test('cursor focus interpolates confident samples', () => {
  expect(focusPointAt(track, 500)).toEqual({ x: 0.5, y: 0.5, confidence: 0.9 });
});

test('cursor focus eases back to center after a long detection gap', () => {
  expect(focusPointAt(track, 2_500)).toEqual({ x: 0.5, y: 0.5, confidence: 0 });
});

test('focused cover clamps the crop at both source edges without exposing empty pixels', () => {
  const left = focusedCoverPlacement(1_920, 1_080, 1_080, 1_920, { x: 0.05, y: 0.5 });
  const right = focusedCoverPlacement(1_920, 1_080, 1_080, 1_920, { x: 0.95, y: 0.5 });

  expect(left.dx).toBe(0);
  expect(right.dx + right.dw).toBeCloseTo(1_080, 5);
  expect(left.dy).toBeLessThanOrEqual(0);
  expect(left.dy + left.dh).toBeGreaterThanOrEqual(1_920);
});
