import { expect, test } from '@playwright/test';
import { mkdtemp, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createTeachingAssetResponse,
  parseTeachingAssetUrl,
  teachingAssetUrl,
} from '../../apps/desktop/src/teachingAssetProtocol';

const CHECKSUM = 'a'.repeat(64);

test('teaching asset URLs identify only a manifest-owned asset and reject local paths, query strings, and unknown structure', () => {
  const url = teachingAssetUrl('recording_1', { assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM });
  expect(parseTeachingAssetUrl(url)).toEqual({
    recordingId: 'recording_1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM,
  });
  for (const invalid of [
    'excalicast-asset://project/recording_1/sfx-pop/1.0.0/a'.repeat(1),
    `excalicast-asset://project/recording_1/sfx-pop/1.0.0/${CHECKSUM}?path=/etc/hosts`,
    `excalicast-asset://project/recording_1/../../etc/hosts/1.0.0/${CHECKSUM}`,
    `file:///tmp/sfx-pop.wav`,
  ]) expect(() => parseTeachingAssetUrl(invalid)).toThrow('teaching_asset_url_invalid');
});

test('the protocol streams an already-resolved whitelisted asset with Range support and never accepts a renderer path', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'teaching-asset-protocol-')), 'sfx.wav');
  await writeFile(file, 'abcdefghij');
  const fileHandle = await open(file, 'r');
  const url = teachingAssetUrl('recording_1', { assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM });
  const calls: unknown[] = [];
  let released = 0;
  const response = await createTeachingAssetResponse(new Request(url, { headers: { range: 'bytes=2-5' } }), async (identity) => {
    calls.push(identity);
    return { path: file, byteLength: 10, mimeType: 'audio/wav', fileHandle, release: () => { released += 1; } };
  });
  expect(response.status).toBe(206);
  expect(await response.text()).toBe('cdef');
  expect(released).toBe(1);
  expect(calls).toEqual([{ recordingId: 'recording_1', assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM }]);
  await fileHandle.close();
});

test('the protocol refuses a pathname-only resolver result so verification cannot be followed by a path swap', async () => {
  const url = teachingAssetUrl('recording_1', { assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM });
  await expect(createTeachingAssetResponse(new Request(url), async () => ({
    path: '/untrusted/reopen.wav', byteLength: 10, mimeType: 'audio/wav' as const,
  }))).rejects.toThrow('teaching_asset_descriptor_unverified');
});

test('invalid Range responses release every acquired lease', async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'teaching-asset-protocol-')), 'sfx.wav');
  await writeFile(file, 'abcdefghij');
  const handle = await open(file, 'r');
  const url = teachingAssetUrl('recording_1', { assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM });
  let releases = 0;
  for (let index = 0; index < 65; index += 1) {
    await expect(createTeachingAssetResponse(new Request(url, { headers: { range: 'bytes=999-1000' } }), async () => ({
      path: file, byteLength: 10, mimeType: 'audio/wav' as const, fileHandle: handle,
      release: () => { releases += 1; },
    }))).rejects.toThrow('native_media_range_invalid');
  }
  expect(releases).toBe(65);
  await handle.close();
});
