import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { finalizeDesktopTeachingComposition } from '../../apps/desktop/src/teachingCompositionLifecycle';
import { readReadyTeachingCompositionManifest } from '../../apps/desktop/src/teachingCompositionManifest';
import { persistDesktopTeachingPreselection } from '../../apps/desktop/src/teachingPreselectionManifest';
import type { NativeRecordingManifest, NativeRecordingValidationReport } from '../../apps/desktop/src/nativeHelperClient';

const recordingId = 'native-teaching-flow';

async function writeNativeProject(projectRoot: string): Promise<{
  manifest: NativeRecordingManifest;
  validation: NativeRecordingValidationReport;
}> {
  const telemetryPath = path.join(projectRoot, 'segments', 'input-telemetry', '000000.segment');
  await mkdir(path.dirname(telemetryPath), { recursive: true });
  const telemetry = {
    schemaVersion: 1, sessionId: recordingId, index: 0, startUs: 0, endUs: 2_999_999,
    events: [{
      schemaVersion: 1, sessionId: recordingId, atUs: 1_000_000, kind: 'click',
      producerId: 'main-whiteboard', producerEpoch: 'producer-1', producerSequence: 0,
      surfaceId: 'whiteboard', x: 100, y: 80, button: 'primary', phase: 'down',
    }],
  };
  const bytes = Buffer.from(JSON.stringify(telemetry));
  await writeFile(telemetryPath, bytes);
  const manifest: NativeRecordingManifest = {
    schemaVersion: 1, recordingId, state: 'ready',
    tracks: {
      screen: [{ index: 0, relativePath: 'segments/screen/000000.mp4', startUs: 0, durationUs: 3_000_000, byteLength: 1 }],
      camera: [], microphone: [], 'system-audio': [], 'excalidraw-events': [],
      'input-telemetry': [{
        index: 0, relativePath: 'segments/input-telemetry/000000.segment', startUs: 0,
        durationUs: 3_000_000, byteLength: bytes.byteLength,
      }],
    },
  };
  await writeFile(path.join(projectRoot, 'manifest.json'), JSON.stringify(manifest));
  const validation: NativeRecordingValidationReport = {
    isValid: true, manifestState: 'ready',
    continuity: {
      isValid: true, requiredTracks: ['screen'],
      tracks: { screen: { track: 'screen', segmentCount: 1, firstStartUs: 0, endUs: 3_000_000, maximumGapUs: 0, maximumOverlapUs: 0, issues: [] } },
    },
    segments: [],
  };
  return { manifest, validation };
}

async function setupCatalog(root: string, kind: 'sound-effect' | 'motion-graphic' = 'sound-effect') {
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, kind === 'sound-effect' ? 'pop.wav' : 'motion.webm');
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'verified-native-capture-asset');
  const checksum = createHash('sha256').update('verified-native-capture-asset').digest('hex');
  const assetId = kind === 'sound-effect' ? 'lesson-pop' : 'lesson-motion';
  await writeFile(path.join(cacheRoot, 'catalog.json'), JSON.stringify({
    schemaVersion: 1, catalogVersion: 'desktop-native-catalog-1', entries: [{
      assetId, catalogVersion: 'desktop-native-catalog-1', assetVersion: '1.0.0', kind,
      source: { provider: 'bundled', uri: `asset://bundled/${assetId}` },
      license: { licenseId: 'bundled-license', status: 'valid' },
      checksum: { algorithm: 'sha256', value: checksum },
      cache: { status: 'verified', checksum, localUri: `file://${cacheFile}` },
      durationMs: 250, contentSlots: [],
    }],
  }));
  return { cacheRoot, assetId };
}

test('native capture start snapshot plus durable stop telemetry produces a ready SFX export manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-teaching-flow-'));
  const projectRoot = path.join(root, 'Excalicast Projects', recordingId);
  const { cacheRoot, assetId } = await setupCatalog(root);
  const preselection = await persistDesktopTeachingPreselection({
    projectRoot, cacheRoot, catalogPath: path.join(cacheRoot, 'catalog.json'), recordingId,
    recipe: { schemaVersion: 1, enabled: true, teachingPackId: 'teaching-pack-1', selectedAssetIds: [assetId] },
  });
  expect(preselection).toMatchObject({ state: 'ready' });

  const native = await writeNativeProject(projectRoot);
  const result = await finalizeDesktopTeachingComposition({ projectRoot, cacheRoot, recordingId, ...native });
  expect(result).toMatchObject({ state: 'ready', operationCount: 1 });
  const exported = await readReadyTeachingCompositionManifest({ projectRoot, recordingId });
  expect(exported.plan.operations).toMatchObject([{ operation: 'mix-sound-effect', startMs: 1_000 }]);
  expect(JSON.parse(await readFile(path.join(projectRoot, 'teaching', 'composition.json'), 'utf8')).plan.operations).toHaveLength(1);
});

test('native stop never marks a visual-selection plan ready before a native visual renderer exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-teaching-flow-'));
  const projectRoot = path.join(root, 'Excalicast Projects', recordingId);
  const { cacheRoot, assetId } = await setupCatalog(root, 'motion-graphic');
  await persistDesktopTeachingPreselection({
    projectRoot, cacheRoot, catalogPath: path.join(cacheRoot, 'catalog.json'), recordingId,
    recipe: { schemaVersion: 1, enabled: true, teachingPackId: 'teaching-pack-1', selectedAssetIds: [assetId] },
  });
  const native = await writeNativeProject(projectRoot);
  await expect(finalizeDesktopTeachingComposition({ projectRoot, cacheRoot, recordingId, ...native }))
    .resolves.toEqual({ state: 'unsupported', code: 'teaching_composition_unsupported_capability' });
  await expect(readReadyTeachingCompositionManifest({ projectRoot, recordingId }))
    .rejects.toThrow('teaching_composition_manifest_missing');
});
