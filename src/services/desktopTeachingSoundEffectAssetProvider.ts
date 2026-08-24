import { teachingAssetUrl } from '@/desktop/teachingAssetProtocol';
import type {
  DecodedTeachingSoundEffect,
  TeachingSoundEffectAssetProvider,
  TeachingSoundEffectAssetRef,
} from './teachingSoundEffectMixer';

export const DESKTOP_TEACHING_SFX_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
export const DESKTOP_TEACHING_SFX_MAX_PCM_BYTES = 64 * 1024 * 1024;
export const DESKTOP_TEACHING_SFX_CHUNK_FRAMES = 4_096;

export type TeachingSoundEffectBlobDecoder = (
  blob: Blob,
  signal?: AbortSignal,
) => Promise<DecodedTeachingSoundEffect>;

export interface DesktopTeachingSoundEffectAssetProviderOptions {
  readonly recordingId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly decode?: TeachingSoundEffectBlobDecoder;
  readonly maxCompressedBytes?: number;
}

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ASSET_ID = /^[a-zA-Z0-9_.-]{1,160}$/;
const ASSET_VERSION = /^[a-zA-Z0-9_.-]{1,80}$/;
const CHECKSUM = /^[a-f0-9]{64}$/;

function fail(code: string): never { throw new Error(code); }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Teaching sound-effect decode cancelled', 'AbortError');
}

function validateIdentity(recordingId: string, asset: TeachingSoundEffectAssetRef): void {
  if (!RECORDING_ID.test(recordingId)
    || !ASSET_ID.test(asset.assetId)
    || !ASSET_VERSION.test(asset.assetVersion)
    || !CHECKSUM.test(asset.checksum)) fail('teaching_sfx_asset_identity_invalid');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('teaching_sfx_asset_limit_invalid');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) fail('teaching_sfx_asset_limit_exceeded');
  }
  if (!response.body) fail('teaching_sfx_asset_read_failed');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      total += value.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) fail('teaching_sfx_asset_limit_exceeded');
      parts.push(value);
    }
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (total < 1) fail('teaching_sfx_asset_read_failed');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** Decode locally fetched, catalog-normalized (48 kHz mono) audio into bounded PCM chunks. */
export const decodeDesktopTeachingSoundEffectBlob: TeachingSoundEffectBlobDecoder = async (blob, signal) => {
  throwIfAborted(signal);
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({
    source: new BlobSource(blob, { maxCacheSize: 2 * 1024 * 1024, useStreamReader: true }),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) fail('teaching_sfx_asset_audio_missing');
    const sink = new AudioSampleSink(track);
    const chunks: Array<{ channels: Float32Array[] }> = [];
    let frames = 0;
    let pcmBytes = 0;
    for await (const sample of sink.samples()) {
      try {
        throwIfAborted(signal);
        if (sample.sampleRate !== 48_000 || sample.numberOfChannels !== 1
          || !Number.isSafeInteger(sample.numberOfFrames) || sample.numberOfFrames < 1) {
          fail('teaching_sfx_asset_format_unsupported');
        }
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
        for (let offset = 0; offset < plane.length; offset += DESKTOP_TEACHING_SFX_CHUNK_FRAMES) {
          const chunk = plane.slice(offset, Math.min(plane.length, offset + DESKTOP_TEACHING_SFX_CHUNK_FRAMES));
          frames += chunk.length;
          pcmBytes += chunk.byteLength;
          if (!Number.isSafeInteger(frames) || pcmBytes > DESKTOP_TEACHING_SFX_MAX_PCM_BYTES) {
            fail('teaching_sfx_asset_pcm_limit_exceeded');
          }
          chunks.push({ channels: [chunk] });
        }
      } finally {
        sample.close();
      }
    }
    if (frames < 1) fail('teaching_sfx_asset_audio_missing');
    return { sampleRate: 48_000, channelCount: 1, totalFrames: frames, chunks };
  } finally {
    input.dispose();
  }
};

/**
 * The renderer-side provider deliberately ignores `asset.localUri`: it fetches
 * only a checked identity through Electron's local protocol. Main revalidates
 * that identity against the recording-owned manifest before streaming bytes.
 */
export function createDesktopTeachingSoundEffectAssetProvider(
  options: DesktopTeachingSoundEffectAssetProviderOptions,
): TeachingSoundEffectAssetProvider {
  const fetchAsset = options.fetch ?? globalThis.fetch;
  const decode = options.decode ?? decodeDesktopTeachingSoundEffectBlob;
  const maxCompressedBytes = options.maxCompressedBytes ?? DESKTOP_TEACHING_SFX_MAX_COMPRESSED_BYTES;
  if (typeof fetchAsset !== 'function' || !Number.isSafeInteger(maxCompressedBytes) || maxCompressedBytes < 1) {
    fail('teaching_sfx_provider_invalid');
  }
  return {
    async loadLocalPcm(asset, requestOptions) {
      const signal = requestOptions.signal;
      throwIfAborted(signal);
      validateIdentity(options.recordingId, asset);
      const response = await fetchAsset(teachingAssetUrl(options.recordingId, asset), { signal });
      throwIfAborted(signal);
      if (!response.ok) fail('teaching_sfx_asset_read_failed');
      const bytes = await readBoundedResponse(response, maxCompressedBytes, signal);
      if (await sha256(bytes) !== asset.checksum.toLowerCase()) fail('teaching_sfx_asset_checksum_unverified');
      throwIfAborted(signal);
      const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return decode(new Blob([blobBytes], { type: response.headers.get('content-type') ?? 'application/octet-stream' }), signal);
    },
  };
}
