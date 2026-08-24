import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

import {
  createDesktopTeachingSoundEffectAssetProvider,
  type TeachingSoundEffectBlobDecoder,
} from '@/services/desktopTeachingSoundEffectAssetProvider';

const BYTES = new TextEncoder().encode('local-sfx-bytes');
const CHECKSUM = createHash('sha256').update(BYTES).digest('hex');

const decoder: TeachingSoundEffectBlobDecoder = async () => ({
  sampleRate: 48_000,
  channelCount: 1,
  totalFrames: 2,
  chunks: [{ channels: [Float32Array.from([0.2, -0.2])] }],
});

test('desktop provider reads only the manifest asset identity through the local protocol and validates its checksum before decoding', async () => {
  const requested: string[] = [];
  const provider = createDesktopTeachingSoundEffectAssetProvider({
    recordingId: 'recording-1',
    fetch: async (input) => {
      requested.push(String(input));
      return new Response(BYTES, { headers: { 'content-type': 'audio/wav', 'content-length': String(BYTES.byteLength) } });
    },
    decode: decoder,
  });
  const decoded = await provider.loadLocalPcm({
    assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM, localUri: 'file:///never/read/sfx-pop.wav',
  }, {});
  expect(requested).toEqual([`excalicast-asset://project/recording-1/sfx-pop/1.0.0/${CHECKSUM}`]);
  expect(decoded.totalFrames).toBe(2);
});

test('desktop provider refuses a checksum mismatch and cancellation before decode', async () => {
  let decodes = 0;
  const provider = createDesktopTeachingSoundEffectAssetProvider({
    recordingId: 'recording-1',
    fetch: async () => new Response(BYTES),
    decode: async (...args) => { decodes += 1; return decoder(...args); },
  });
  await expect(provider.loadLocalPcm({
    assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: 'b'.repeat(64), localUri: 'file:///ignored.wav',
  }, {})).rejects.toThrow('teaching_sfx_asset_checksum_unverified');
  expect(decodes).toBe(0);

  const controller = new AbortController();
  controller.abort();
  await expect(provider.loadLocalPcm({
    assetId: 'sfx-pop', assetVersion: '1.0.0', checksum: CHECKSUM, localUri: 'file:///ignored.wav',
  }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
