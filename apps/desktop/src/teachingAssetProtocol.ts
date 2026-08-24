import type { ResolvedTeachingCompositionAsset } from './teachingCompositionManifest';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { parseMediaRange } from './nativeMediaProtocol';
import {
  parseTeachingAssetUrl,
  TEACHING_ASSET_SCHEME,
  type TeachingAssetIdentity,
} from '../../../src/desktop/teachingAssetProtocol';

export { parseTeachingAssetUrl, teachingAssetUrl, TEACHING_ASSET_SCHEME } from '../../../src/desktop/teachingAssetProtocol';
export type { TeachingAssetIdentity } from '../../../src/desktop/teachingAssetProtocol';

export type TeachingAssetLease = ResolvedTeachingCompositionAsset & {
  /** Releases the verified descriptor only after the HTTP body has closed. */
  release?: () => void | Promise<void>;
};

/**
 * Main-process protocol implementation. The caller must resolve the identity
 * against the persisted manifest; the renderer never sends or controls a path.
 */
export async function createTeachingAssetResponse(
  request: Request,
  resolve: (identity: TeachingAssetIdentity) => Promise<TeachingAssetLease>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const identity = parseTeachingAssetUrl(request.url);
  const asset = await resolve(identity);
  let bodyOwnsLease = false;
  try {
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': asset.mimeType,
          'Content-Length': String(asset.byteLength),
          'Cache-Control': 'private, no-store',
        },
      });
    }
    // A pathname-only result would reopen the cache after verification. The
    // protocol accepts only the descriptor retained by manifest resolution.
    if (!asset.fileHandle) throw new Error('teaching_asset_descriptor_unverified');
    const range = parseMediaRange(request.headers.get('range'), asset.byteLength);
    const start = range?.start ?? 0;
    const end = range?.end ?? asset.byteLength - 1;
    const stream = createReadStream(asset.path, {
      fd: asset.fileHandle.fd,
      autoClose: false,
      start,
      end,
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void asset.release?.();
    };
    stream.once('end', release);
    stream.once('close', release);
    stream.once('error', release);
    bodyOwnsLease = true;
    // The handle remains owned by the bounded main-process cache. No response
    // re-opens the renderer-visible pathname after verification.
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': asset.mimeType,
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'private, no-store',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${asset.byteLength}` } : {}),
      },
    });
  } finally {
    if (!bodyOwnsLease) await asset.release?.();
  }
}
