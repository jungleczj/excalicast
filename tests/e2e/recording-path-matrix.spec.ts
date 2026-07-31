import { expect, test } from '@playwright/test';
import {
  projectRecordingSetupToExport,
} from '../../src/services/recordingSetupProjection';
import type {
  AspectRatio,
  RecordingSetupConfig,
  RecordingSourceKind,
} from '../../src/types/recording';

const SOURCES: RecordingSourceKind[] = [
  'whiteboard',
  'current_tab',
  'window',
  'desktop',
  'selected_area',
];
const PRESETS: AspectRatio[] = [
  '16:9',
  '4:3',
  '21:9',
  '16:10',
  '3:2',
  '9:16',
  '4:5',
  '3:4',
  '2:3',
  '1:1',
];
const FRAMINGS: RecordingSetupConfig['framing'][] = ['default', ...PRESETS, 'custom'];

function setupFor(
  sourceKind: RecordingSourceKind,
  cameraEnabled: boolean,
  framing: RecordingSetupConfig['framing'],
): RecordingSetupConfig {
  const display = sourceKind !== 'whiteboard';
  return {
    source: {
      kind: sourceKind,
      sourceSize: display ? { width: 3840, height: 2160 } : undefined,
      sourceCropWindow: display ? { rx: 0.2, ry: 0.1, rw: 0.5, rh: 0.7 } : undefined,
    },
    camera: {
      enabled: cameraEnabled,
      sizePx: 180,
      shape: 'circle',
      position: 'bottom-right',
      backgroundRemoval: false,
    },
    framing,
    croppingMode: 'fit_all_content',
    cropWindow: { rx: 0.1, ry: 0.15, rw: 0.7, rh: 0.65 },
    customOutput: framing === 'custom' ? { width: 1170, height: 2532 } : undefined,
    includeWorkspaceShell: true,
  };
}

test('covers all 120 source, camera and framing combinations', () => {
  const cases = SOURCES.flatMap((source) =>
    [false, true].flatMap((camera) =>
      FRAMINGS.map((framing) => ({ source, camera, framing })),
    ),
  );
  expect(cases).toHaveLength(120);

  for (const item of cases) {
    const setup = setupFor(item.source, item.camera, item.framing);
    const result = projectRecordingSetupToExport(setup);
    expect(result.croppingMode).toBe('fit_all_content');
    expect(result.alwaysKeepZoomedIn).toBe(false);

    if (item.framing === 'custom') {
      expect(result.customOutput).toEqual({ width: 1170, height: 2532 });
      expect(result.aspectRatio).toBe('9:16');
    } else if (item.framing === 'default') {
      expect(result.aspectRatio).toBe('16:9');
      if (item.source === 'whiteboard') expect(result.customOutput).toBeUndefined();
      else expect(result.customOutput).toEqual({ width: 3840, height: 2160 });
    } else {
      expect(result.aspectRatio).toBe(item.framing);
      expect(result.customOutput).toBeUndefined();
    }

    if (item.source === 'whiteboard' && item.framing !== 'default') {
      expect(result.cropWindow).toEqual(setup.cropWindow);
    } else {
      expect(result.cropWindow).toBeUndefined();
    }
  }
});

test('display source crop stays in source metadata and never becomes a whiteboard crop', () => {
  const setup = setupFor('desktop', true, '9:16');
  const result = projectRecordingSetupToExport(setup);
  expect(setup.source?.sourceCropWindow).toEqual({ rx: 0.2, ry: 0.1, rw: 0.5, rh: 0.7 });
  expect(result.cropWindow).toBeUndefined();
  expect(result.aspectRatio).toBe('9:16');
});
