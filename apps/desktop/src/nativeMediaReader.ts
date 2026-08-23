import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NativeRecordingSegment, NativeRecordingTrack } from './nativeHelperClient';

export const NATIVE_MEDIA_RANGE_MAX_BYTES = 4 * 1024 * 1024;

export type NativeReadableMediaTrack = Extract<
  NativeRecordingTrack,
  'screen' | 'camera' | 'microphone' | 'system-audio'
>;

interface NativeMediaReadableManifest {
  tracks: Record<string, NativeRecordingSegment[] | undefined>;
}

export interface NativeMediaRangeRequest {
  track: NativeReadableMediaTrack;
  segmentIndex: number;
  offset: number;
  length: number;
}

export interface NativeMediaRangeResult {
  data: Uint8Array;
  totalByteLength: number;
  offset: number;
  eof: boolean;
  mimeType: 'video/mp4' | 'audio/mp4';
}

const READABLE_TRACKS = new Set<NativeReadableMediaTrack>([
  'screen', 'camera', 'microphone', 'system-audio',
]);

export async function readNativeMediaSegmentRange(
  projectRoot: string,
  manifest: NativeMediaReadableManifest,
  request: NativeMediaRangeRequest,
): Promise<NativeMediaRangeResult> {
  if (!READABLE_TRACKS.has(request.track)) throw new Error('native_media_track_invalid');
  if (!Number.isSafeInteger(request.segmentIndex) || request.segmentIndex < 0
    || !Number.isSafeInteger(request.offset) || request.offset < 0
    || !Number.isSafeInteger(request.length) || request.length < 1
    || request.length > NATIVE_MEDIA_RANGE_MAX_BYTES) {
    throw new Error('native_media_range_invalid');
  }

  const segment = manifest.tracks[request.track]
    ?.find((candidate) => candidate.index === request.segmentIndex);
  if (!segment) throw new Error('native_media_segment_not_found');
  const root = path.resolve(projectRoot);
  const expectedPrefix = `segments/${request.track}/`;
  if (!segment.relativePath.startsWith(expectedPrefix) || segment.relativePath.startsWith('/')) {
    throw new Error('native_media_segment_path_invalid');
  }
  const filePath = path.resolve(root, segment.relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('native_media_segment_path_invalid');
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size !== segment.byteLength || request.offset > fileStat.size) {
    throw new Error('native_media_segment_invalid');
  }

  const requestedBytes = Math.min(request.length, fileStat.size - request.offset);
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(requestedBytes);
    const { bytesRead } = await handle.read(buffer, 0, requestedBytes, request.offset);
    return {
      data: new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead)),
      totalByteLength: fileStat.size,
      offset: request.offset,
      eof: request.offset + bytesRead >= fileStat.size,
      mimeType: request.track === 'screen' || request.track === 'camera' ? 'video/mp4' : 'audio/mp4',
    };
  } finally {
    await handle.close();
  }
}
