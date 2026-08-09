import { expect, test } from '@playwright/test';
import { resolveCoverPlacement } from '@/services/videoBackgroundRenderer';

test('cover placement fills every supported output shape without stretching the wallpaper', () => {
  const source = { width: 1600, height: 900 };
  const outputs = [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 1080, height: 1080 },
    { width: 1080, height: 1350 },
    { width: 2560, height: 1080 },
    { width: 997, height: 1379 },
  ];

  for (const output of outputs) {
    const placement = resolveCoverPlacement(source.width, source.height, output.width, output.height);
    expect(placement.dx).toBe(0);
    expect(placement.dy).toBe(0);
    expect(placement.dw).toBe(output.width);
    expect(placement.dh).toBe(output.height);
    expect(placement.sx).toBeGreaterThanOrEqual(0);
    expect(placement.sy).toBeGreaterThanOrEqual(0);
    expect(placement.sx + placement.sw).toBeLessThanOrEqual(source.width + 0.001);
    expect(placement.sy + placement.sh).toBeLessThanOrEqual(source.height + 0.001);
    expect(placement.sw / placement.sh).toBeCloseTo(output.width / output.height, 6);
  }
});

test('portrait cover placement crops the wallpaper symmetrically from both sides', () => {
  const placement = resolveCoverPlacement(1600, 900, 1080, 1920);

  expect(placement.sy).toBe(0);
  expect(placement.sh).toBe(900);
  expect(placement.sx).toBeCloseTo((1600 - placement.sw) / 2, 6);
  expect(placement.sw).toBeCloseTo(506.25, 6);
});
