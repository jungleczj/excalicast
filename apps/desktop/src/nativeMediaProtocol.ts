import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export const NATIVE_MEDIA_SCHEME = 'excalicast-media';
export type NativeProtocolTrack = 'screen' | 'camera' | 'microphone' | 'system-audio';

const TRACKS = new Set<NativeProtocolTrack>(['screen', 'camera', 'microphone', 'system-audio']);

export function nativeMediaUrl(recordingId: string, track: NativeProtocolTrack): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId) || !TRACKS.has(track)) {
    throw new Error('native_media_url_invalid');
  }
  return `${NATIVE_MEDIA_SCHEME}://project/${recordingId}/${track}`;
}

export function parseNativeMediaUrl(value: string): { recordingId: string; track: NativeProtocolTrack } {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  const track = parts[1] as NativeProtocolTrack;
  if (url.protocol !== `${NATIVE_MEDIA_SCHEME}:`
    || url.hostname !== 'project'
    || parts.length !== 2
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(parts[0] ?? '')
    || !TRACKS.has(track)
    || url.search
    || url.hash) {
    throw new Error('native_media_url_invalid');
  }
  return { recordingId: parts[0], track };
}

export function parseMediaRange(value: string | null, byteLength: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || byteLength <= 0) throw new Error('native_media_range_invalid');
  const [, startText, endText] = match;
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('native_media_range_invalid');
    start = Math.max(0, byteLength - suffix);
    end = byteLength - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : byteLength - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= byteLength || end < start) {
    throw new Error('native_media_range_invalid');
  }
  return { start, end: Math.min(end, byteLength - 1) };
}

export async function createNativeMediaResponse(
  request: Request,
  filePath: string,
  mimeType: string,
): Promise<Response> {
  const info = await stat(filePath);
  const range = parseMediaRange(request.headers.get('range'), info.size);
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType,
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, no-store',
  });
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  });
}
