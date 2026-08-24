import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { createTeachingAssetResponse, teachingAssetUrl } from '../../apps/desktop/src/teachingAssetProtocol';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  readReadyTeachingCompositionManifest,
  resolveTeachingAssetFromManifest,
  writeReadyTeachingCompositionManifest,
} from '../../apps/desktop/src/teachingCompositionManifest';

const CHECKSUM = createHash('sha256').update('fixture-sfx').digest('hex');

function manifestInput(cacheFile: string) {
  const asset = {
    assetId: 'sfx-pop',
    catalogVersion: 'catalog-1',
    assetVersion: '1.0.0',
    kind: 'sound-effect' as const,
    source: { provider: 'bundled' as const, uri: 'asset://bundled/sfx-pop' },
    license: { licenseId: 'bundled', status: 'valid' as const },
    checksum: { algorithm: 'sha256' as const, value: CHECKSUM },
    cache: { status: 'verified' as const, checksum: CHECKSUM, localUri: `file://${cacheFile}` },
    durationMs: 400,
    contentSlots: [],
  };
  return {
    recordingId: 'recording-1',
    catalog: {
      schemaVersion: 1 as const,
      catalogVersion: 'catalog-1',
      entries: [asset],
    },
    selection: {
      schemaVersion: 1 as const,
      teachingPackId: 'pack-1',
      catalogVersion: 'catalog-1',
      assets: [asset],
    },
    plan: {
      schemaVersion: 1 as const,
      sourceRecordingId: 'recording-1',
      durationMs: 2_000,
      teachingPackId: 'pack-1',
      catalogVersion: 'catalog-1',
      selectedAssetIds: ['sfx-pop'],
      sourceTracks: [{ trackId: 'mic', kind: 'microphone' as const }],
      operations: [{
        operationId: 'teaching:sound-effect:0000:sfx-pop',
        operation: 'mix-sound-effect' as const,
        track: 'sound-effect' as const,
        asset: {
          assetId: 'sfx-pop', kind: 'sound-effect' as const, catalogVersion: 'catalog-1',
          assetVersion: '1.0.0', checksumAlgorithm: 'sha256' as const, checksum: CHECKSUM,
          localUri: `file://${cacheFile}`,
        },
        startMs: 100,
        endMs: 500,
        trim: { sourceStartMs: 0 as const, sourceEndMs: 400, playbackMode: 'once' as const },
        zOrder: 0,
        transition: { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' as const },
        content: [],
        audio: {
          gainDb: -8,
          gainCeilingDb: 0,
          ducking: { targetSourceTracks: ['mic'], attenuationDb: -6, attackMs: 80, releaseMs: 240 },
          mixesAsIndependentEffect: true as const,
        },
      }],
    },
  };
}

test('atomically persists an owned, checksummed composition snapshot and never creates a path supplied by the renderer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  const written = await writeReadyTeachingCompositionManifest({ projectRoot, cacheRoot, ...manifestInput(cacheFile) });

  expect(written.state).toBe('ready');
  expect(written.planChecksum).toMatch(/^[a-f0-9]{64}$/);
  const persisted = JSON.parse(await readFile(path.join(projectRoot, 'teaching', 'composition.json'), 'utf8'));
  expect(persisted.plan.operations).toHaveLength(1);
  expect(await readReadyTeachingCompositionManifest({ projectRoot, recordingId: 'recording-1' })).toEqual(written);
});

test('asset resolution fails closed for a forged plan URI or a symlinked cache asset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  await writeReadyTeachingCompositionManifest({ projectRoot, cacheRoot, ...manifestInput(cacheFile) });

  const resolved = await resolveTeachingAssetFromManifest({
    projectRoot, cacheRoot, recordingId: 'recording-1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM,
  });
  expect(resolved).toMatchObject({ path: await realpath(cacheFile), byteLength: 11 });
  await resolved.fileHandle?.close();
  await expect(resolveTeachingAssetFromManifest({
    projectRoot, cacheRoot, recordingId: 'recording-1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: 'b'.repeat(64),
  })).rejects.toThrow('teaching_asset_identity_unverified');

  await (await import('node:fs/promises')).unlink(cacheFile);
  await symlink('/etc/hosts', cacheFile);
  await expect(resolveTeachingAssetFromManifest({
    projectRoot, cacheRoot, recordingId: 'recording-1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM,
  })).rejects.toThrow('teaching_asset_cache_path_unverified');
});

test('manifest persistence rejects a symlinked teaching directory instead of writing outside the recording project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  await (await import('node:fs/promises')).mkdir(projectRoot, { recursive: true });
  await symlink(path.join(root, 'outside'), path.join(projectRoot, 'teaching'));
  await expect(writeReadyTeachingCompositionManifest({ projectRoot, cacheRoot, ...manifestInput(cacheFile) }))
    .rejects.toThrow('teaching_composition_manifest_directory_unverified');
});

test('a verified asset retains its checked file descriptor when its cache pathname is swapped after verification', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  await writeReadyTeachingCompositionManifest({ projectRoot, cacheRoot, ...manifestInput(cacheFile) });
  const resolved = await resolveTeachingAssetFromManifest({
    projectRoot, cacheRoot, recordingId: 'recording-1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM,
  });
  await rename(cacheFile, `${cacheFile}.verified`);
  await writeFile(cacheFile, 'attacker-bytes');
  const response = await createTeachingAssetResponse(
    new Request(teachingAssetUrl('recording-1', { assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM })),
    async () => resolved,
  );
  expect(await response.text()).toBe('fixture-sfx');
  await resolved.fileHandle?.close();
});

test('aborted composition persistence publishes no ready manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  const controller = new AbortController();
  controller.abort();
  await expect(writeReadyTeachingCompositionManifest({
    projectRoot, cacheRoot, ...manifestInput(cacheFile), signal: controller.signal,
  })).rejects.toThrow('teaching_composition_cancelled');
  await expect(readReadyTeachingCompositionManifest({ projectRoot, recordingId: 'recording-1' }))
    .rejects.toThrow('teaching_composition_manifest_missing');
});

test('cancellation after asset hashing removes the fsynced temporary manifest before publish', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'teaching-composition-'));
  const cacheRoot = path.join(root, 'Teaching Assets');
  const cacheFile = path.join(cacheRoot, 'sfx-pop.wav');
  await (await import('node:fs/promises')).mkdir(cacheRoot, { recursive: true });
  await writeFile(cacheFile, 'fixture-sfx');
  const projectRoot = path.join(root, 'Excalicast Projects', 'recording-1');
  let abortChecks = 0;
  const signal = {
    get aborted() {
      abortChecks += 1;
      return abortChecks >= 5;
    },
  } as AbortSignal;

  await expect(writeReadyTeachingCompositionManifest({
    projectRoot, cacheRoot, ...manifestInput(cacheFile), signal,
  })).rejects.toThrow('teaching_composition_cancelled');
  const teachingDirectory = path.join(projectRoot, 'teaching');
  expect(await readdir(teachingDirectory)).toEqual([]);
  await expect(readReadyTeachingCompositionManifest({ projectRoot, recordingId: 'recording-1' }))
    .rejects.toThrow('teaching_composition_manifest_missing');
});
