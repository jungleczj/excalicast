import { expect, test } from '@playwright/test';
import {
  cropToViewportRect,
  fitSourcePreview,
  viewportPointToSource,
} from '../../src/services/displaySourceFraming';

test('a 4K source is contained inside the framing viewport without making letterbox space selectable', () => {
  const preview = fitSourcePreview({
    viewportWidth: 1_200,
    viewportHeight: 800,
    sourceWidth: 3_840,
    sourceHeight: 2_160,
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  expect(preview).toEqual({ x: 0, y: 62.5, width: 1_200, height: 675 });
  expect(viewportPointToSource({ x: 0, y: 0 }, preview)).toEqual({ x: 0, y: 0 });
  expect(viewportPointToSource({ x: 1_200, y: 800 }, preview)).toEqual({ x: 1, y: 1 });
});

test('zoom and pan preserve normalized source coordinates', () => {
  const preview = fitSourcePreview({
    viewportWidth: 1_200,
    viewportHeight: 800,
    sourceWidth: 3_840,
    sourceHeight: 2_160,
    zoom: 2,
    panX: 300,
    panY: 50,
  });

  expect(preview).toEqual({ x: -300, y: -225, width: 2_400, height: 1_350 });
  expect(viewportPointToSource({ x: 900, y: 450 }, preview)).toEqual({ x: 0.5, y: 0.5 });
});

test('normalized crop maps back to the visible source preview at any zoom', () => {
  const preview = fitSourcePreview({
    viewportWidth: 1_200,
    viewportHeight: 800,
    sourceWidth: 3_840,
    sourceHeight: 2_160,
    zoom: 2,
    panX: 300,
    panY: 50,
  });

  expect(cropToViewportRect({ rx: 0.25, ry: 0.2, rw: 0.5, rh: 0.6 }, preview)).toEqual({
    x: 300,
    y: 45,
    width: 1_200,
    height: 810,
  });
});
