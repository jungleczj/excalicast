import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NativeRecordingSegment } from './nativeHelperClient';

interface NativeInkReadableManifest {
  tracks: Record<string, NativeRecordingSegment[] | undefined>;
}

export async function readNativeInkEventSegments(
  projectRoot: string,
  manifest: NativeInkReadableManifest,
): Promise<Array<{ startUs: number; durationUs: number; payload: string }>> {
  const root = path.resolve(projectRoot);
  const segments = [...(manifest.tracks['excalidraw-events'] ?? [])]
    .sort((a, b) => a.index - b.index);
  const result: Array<{ startUs: number; durationUs: number; payload: string }> = [];
  for (const segment of segments) {
    const filePath = path.resolve(root, segment.relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error('native_ink_event_path_invalid');
    }
    const payload = await readFile(filePath, 'utf8');
    if (Buffer.byteLength(payload, 'utf8') !== segment.byteLength || payload.length === 0) {
      throw new Error('native_ink_event_segment_invalid');
    }
    result.push({
      startUs: segment.startUs,
      durationUs: segment.durationUs,
      payload,
    });
  }
  return result;
}
