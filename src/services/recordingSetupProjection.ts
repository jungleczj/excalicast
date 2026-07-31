import {
  ASPECT_PRESETS,
  type AspectRatio,
  type ExportConfig,
  type RecordingSetupConfig,
} from '@/types/recording';

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  aspectRatio: '16:9',
  croppingMode: 'fit_all_content',
  alwaysKeepZoomedIn: false,
  fps: 15,
  withWatermark: true,
};

export function nearestAspectPreset(width: number, height: number): AspectRatio {
  if (!width || !height) return '16:9';
  const target = width / height;
  let best: AspectRatio = '16:9';
  let bestDiff = Infinity;
  for (const [id, preset] of Object.entries(ASPECT_PRESETS) as [
    AspectRatio,
    (typeof ASPECT_PRESETS)[AspectRatio],
  ][]) {
    const diff = Math.abs(preset.width / preset.height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return best;
}

function rememberInitialFraming(config: ExportConfig): ExportConfig {
  if (!config.cropWindow && !config.customOutput) return config;
  return {
    ...config,
    ratioFraming: {
      [config.aspectRatio]: {
        croppingMode: config.croppingMode,
        alwaysKeepZoomedIn: config.alwaysKeepZoomedIn,
        cropWindow: config.cropWindow,
        customOutput: config.customOutput,
      },
    },
  };
}

/**
 * Converts recording setup into the editor's initial canvas config.
 * Input source dimensions and source crops never override an explicit output framing.
 */
export function projectRecordingSetupToExport(
  setup: RecordingSetupConfig,
  defaults: ExportConfig = DEFAULT_EXPORT_CONFIG,
): ExportConfig {
  const base: ExportConfig = {
    ...defaults,
    includeWorkspaceShell: setup.includeWorkspaceShell,
    videoBackground: setup.videoBackground,
    croppingMode: 'fit_all_content',
    alwaysKeepZoomedIn: false,
  };
  const isDisplaySource = !!setup.source?.kind && setup.source.kind !== 'whiteboard';

  if (setup.framing === 'custom') {
    const output = setup.customOutput;
    return rememberInitialFraming({
      ...base,
      aspectRatio: nearestAspectPreset(output?.width ?? 16, output?.height ?? 9),
      customOutput: output,
      cropWindow: isDisplaySource ? undefined : setup.cropWindow,
    });
  }

  if (setup.framing !== 'default') {
    return rememberInitialFraming({
      ...base,
      aspectRatio: setup.framing,
      cropWindow: isDisplaySource ? undefined : setup.cropWindow,
    });
  }

  const sourceSize = isDisplaySource ? setup.source?.sourceSize : undefined;
  if (sourceSize?.width && sourceSize.height) {
    return rememberInitialFraming({
      ...base,
      aspectRatio: nearestAspectPreset(sourceSize.width, sourceSize.height),
      customOutput: { width: sourceSize.width, height: sourceSize.height },
    });
  }

  return { ...base, aspectRatio: '16:9' };
}
