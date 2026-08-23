'use client';

import type { RecordingStorageManifest } from '@/types/recording';

export type RecordingMediaTrack = 'screen' | 'camera' | 'audio' | 'system-audio';

const EXTENSIONS: Record<RecordingMediaTrack, string> = {
  screen: 'mp4',
  camera: 'webm',
  audio: 'webm',
  'system-audio': 'webm',
};

export function recordingMediaPath(recordingId: string, track: RecordingMediaTrack): string {
  return `recordings/${recordingId}/${track}.${EXTENSIONS[track]}`;
}

async function fileHandleForPath(path: string): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('invalid_recording_media_path');
  let directory = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, { create: false });
  }
  return directory.getFileHandle(parts[parts.length - 1], { create: false });
}

export function recoverCommittedMediaBlob(blob: Blob, committedBytes: number, mimeType: string): Blob {
  const end = Math.max(0, Math.min(blob.size, committedBytes));
  return blob.slice(0, end, mimeType);
}

export async function readRecordingMediaFile(
  path: string,
  mimeType: string,
  committedBytes?: number,
): Promise<Blob | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return null;
  try {
    const handle = await fileHandleForPath(path);
    const file = await handle.getFile();
    if (file.size === 0) return null;
    if (typeof committedBytes === 'number' && committedBytes > 0 && committedBytes < file.size) {
      return recoverCommittedMediaBlob(file, committedBytes, mimeType);
    }
    return file.type === mimeType ? file : new Blob([file], { type: mimeType });
  } catch {
    return null;
  }
}

export async function removeRecordingMediaDirectory(recordingId: string): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return;
  try {
    const root = await navigator.storage.getDirectory();
    const recordings = await root.getDirectoryHandle('recordings', { create: false });
    await recordings.removeEntry(recordingId, { recursive: true });
  } catch {
    // Missing OPFS data is already equivalent to a successful cleanup.
  }
}

export async function loadScreenRecordingBlob(params: {
  manifest?: RecordingStorageManifest;
  legacyChunks: ReadonlyArray<{ blob: Blob }>;
  readOpfs?: (path: string, mimeType: string, committedBytes?: number) => Promise<Blob | null>;
}): Promise<Blob | null> {
  const screen = params.manifest?.screen;
  if (screen) {
    const fromOpfs = await (params.readOpfs ?? readRecordingMediaFile)(
      screen.path,
      screen.mimeType,
      screen.status === 'done' ? undefined : screen.committedBytes,
    );
    if (fromOpfs) return fromOpfs;
  }
  if (params.legacyChunks.length === 0) return null;
  const mimeType = params.legacyChunks[0].blob.type || 'video/webm';
  return new Blob(params.legacyChunks.map((chunk) => chunk.blob), { type: mimeType });
}
