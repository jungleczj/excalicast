import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  persistDesktopTeachingPreselection,
  readDesktopTeachingPreselection,
} from '../../apps/desktop/src/teachingPreselectionManifest';

const recordingId = 'lesson-preselection';

function catalog(cacheFile: string, checksum: string) {
  return {
    schemaVersion: 1,
    catalogVersion: 'teaching-catalog-1',
    entries: [{
      assetId: 'verified-pop', catalogVersion: 'teaching-catalog-1', assetVersion: '1', kind: 'sound-effect',
      source: { provider: 'bundled', uri: 'asset://bundled/verified-pop' },
      license: { licenseId: 'bundled-license', status: 'valid' },
      checksum: { algorithm: 'sha256', value: checksum },
      cache: { status: 'verified', checksum, localUri: `file://${cacheFile}` },
      durationMs: 250, contentSlots: [],
    }],
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'teaching-preselection-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const projectRoot = path.join(root, 'Excalicast Projects', recordingId);
  const cacheFile = path.join(cacheRoot, 'verified-pop.wav');
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'real-verified-bytes');
  const checksum = createHash('sha256').update('real-verified-bytes').digest('hex');
  const catalogPath = path.join(cacheRoot, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify(catalog(cacheFile, checksum)));
  return { projectRoot, cacheRoot, cacheFile, catalogPath, checksum };
}

test('preselection freezes only a locally checksum-verified authority catalog before capture', async () => {
  const value = await fixture();
  const result = await persistDesktopTeachingPreselection({
    ...value,
    recordingId,
    recipe: { schemaVersion: 1, enabled: true, teachingPackId: 'teaching-pack-1', selectedAssetIds: ['verified-pop'] },
  });
  expect(result).toMatchObject({ state: 'ready', recordingId, catalog: { catalogVersion: 'teaching-catalog-1' } });
  expect(await readDesktopTeachingPreselection({ projectRoot: value.projectRoot, recordingId }))
    .toMatchObject({ state: 'ready' });
});

test('preselection records unsupported when the declared cache checksum does not match local bytes and never blocks capture', async () => {
  const value = await fixture();
  await writeFile(value.cacheFile, 'tampered-after-catalog-sync');
  const result = await persistDesktopTeachingPreselection({
    ...value,
    recordingId,
    recipe: { schemaVersion: 1, enabled: true, teachingPackId: 'teaching-pack-1', selectedAssetIds: ['verified-pop'] },
  });
  expect(result).toMatchObject({ state: 'unsupported', recordingId, code: 'teaching_asset_checksum_unverified' });
});

test('a corrupt preselection is rejected rather than silently treated as absent', async () => {
  const value = await fixture();
  await mkdir(path.join(value.projectRoot, 'teaching'), { recursive: true });
  await writeFile(path.join(value.projectRoot, 'teaching', 'preselection.json'), '{ bad json');
  await expect(readDesktopTeachingPreselection({ projectRoot: value.projectRoot, recordingId }))
    .rejects.toThrow('teaching_preselection_invalid');
});
