'use client';

import { createClient } from '@/lib/supabase/client';
import {
  getClientDb,
  loadFullRecording,
  saveSubtitleSrt,
} from '@/lib/db-client';
import type {
  AudioChunk,
  BinaryFileEntry,
  CameraChunk,
  CameraPositionEvent,
  RecordingMetadata,
  WhiteboardSnapshot,
} from '@/types/recording';

const BUCKET = 'recordings';

export interface CloudRecording {
  id: string;
  userId: string;
  title: string | null;
  startedAt: number;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  subtitleSrt: string | null;
  thumbnail: string | null;
  storagePrefix: string;
  bytesStored: number | null;
  uploadedAt: number;
  updatedAt: number;
}

export interface UploadProgress {
  step: 'metadata' | 'snapshots' | 'audio' | 'camera' | 'cameraPositions' | 'register' | 'done';
  bytesUploaded: number;
  bytesTotal: number;
}

async function ensureUserId(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('login_required');
  return user.id;
}

function pathFor(userId: string, recordingId: string, name: string): string {
  return `${userId}/${recordingId}/${name}`;
}

async function uploadObject(
  userId: string,
  recordingId: string,
  name: string,
  body: Blob | string,
  contentType: string,
): Promise<number> {
  const supabase = createClient();
  const path = pathFor(userId, recordingId, name);
  const blob = typeof body === 'string'
    ? new Blob([body], { type: contentType })
    : body;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });
  if (error) throw new Error(`upload_${name}: ${error.message}`);
  return blob.size;
}

async function gzipString(text: string): Promise<Blob> {
  // CompressionStream is available in Chrome 80+ / Safari 16.4+
  if (typeof CompressionStream === 'undefined') {
    return new Blob([text], { type: 'application/json' });
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzipToString(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    return blob.text();
  }
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    // Not actually gzipped (e.g. old browser uploaded plain JSON), fall back.
    return blob.text();
  }
}

/**
 * Upload one local recording's source data to Supabase Storage and register it
 * in the user's cloud index. Never uploads the rendered MP4 — only the four
 * source files (metadata + snapshots + audio + camera).
 */
export async function uploadRecording(
  recordingId: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ storagePrefix: string }> {
  const userId = await ensureUserId();
  const { metadata, snapshots, audioBlob, cameraBlob, cameraEvents, binaryFiles } =
    await loadFullRecording(recordingId);

  let bytesUploaded = 0;
  const bytesTotal =
    JSON.stringify(metadata).length +
    JSON.stringify(snapshots).length +
    (audioBlob?.size ?? 0) +
    (cameraBlob?.size ?? 0);

  // 1) metadata.json (with title, subtitle, thumbnail inline)
  onProgress?.({ step: 'metadata', bytesUploaded, bytesTotal });
  const metaPayload = JSON.stringify({
    ...metadata,
    binaryFileIds: binaryFiles.map((b) => b.fileId),
    schemaVersion: 1,
  });
  const sizeMeta = await uploadObject(userId, recordingId, 'metadata.json', metaPayload, 'application/json');
  bytesUploaded += sizeMeta;

  // 2) snapshots.json.gz
  onProgress?.({ step: 'snapshots', bytesUploaded, bytesTotal });
  const snapsBlob = await gzipString(JSON.stringify({
    snapshots,
    binaryFiles: binaryFiles.map((b) => ({ fileId: b.fileId, data: b.data })),
  }));
  const sizeSnaps = await uploadObject(
    userId, recordingId, 'snapshots.json.gz', snapsBlob,
    'application/gzip',
  );
  bytesUploaded += sizeSnaps;

  // 3) audio.webm
  if (audioBlob) {
    onProgress?.({ step: 'audio', bytesUploaded, bytesTotal });
    const sizeAudio = await uploadObject(userId, recordingId, 'audio.webm', audioBlob, 'audio/webm');
    bytesUploaded += sizeAudio;
  }

  // 4) camera.webm —— 上传前尝试 WebCodecs 转码为更小代理（VP9 低码率），
  //    省云端存储；不支持/失败则原样上传。
  if (cameraBlob) {
    onProgress?.({ step: 'camera', bytesUploaded, bytesTotal });
    let camUpload = cameraBlob;
    try {
      const { transcodeCameraForUpload } = await import('./webCodecsExport');
      const proxy = await transcodeCameraForUpload(cameraBlob);
      // 仅当代理确实更小才用它
      if (proxy.size > 0 && proxy.size < cameraBlob.size) camUpload = proxy;
    } catch {
      camUpload = cameraBlob; // 回退原始
    }
    const sizeCam = await uploadObject(userId, recordingId, 'camera.webm', camUpload, 'video/webm');
    bytesUploaded += sizeCam;
  }

  // 4b) cameraPositions.json.gz —— 摄像头气泡随时间的位置事件。可选；
  // 老录制不会有这个文件，import 时按缺省 = [] 处理。
  // hidden 字段（v2，软静音支持）也一并上云。
  if (cameraEvents.length > 0) {
    onProgress?.({ step: 'cameraPositions', bytesUploaded, bytesTotal });
    const camPosBlob = await gzipString(JSON.stringify({
      events: cameraEvents.map((e) => ({
        timestamp: e.timestamp,
        rx: e.rx,
        ry: e.ry,
        rs: e.rs,
        ...(e.hidden ? { hidden: true } : {}),
      })),
      schemaVersion: 2,
    }));
    const sizeCamPos = await uploadObject(
      userId, recordingId, 'cameraPositions.json.gz', camPosBlob,
      'application/gzip',
    );
    bytesUploaded += sizeCamPos;
  }

  // 5) Register the row server-side (server enforces Pro tier)
  onProgress?.({ step: 'register', bytesUploaded, bytesTotal });
  const res = await fetch('/api/recordings/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordingId,
      title: metadata.title ?? null,
      startedAt: metadata.startedAt,
      durationMs: metadata.durationMs,
      hasAudio: metadata.hasAudio,
      hasCamera: metadata.hasCamera,
      subtitleSrt: metadata.subtitleSrt ?? null,
      thumbnail: metadata.lastFrameThumbnail ?? null,
      bytesStored: bytesUploaded,
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message ?? j.error ?? `register_failed: ${res.status}`);
  }
  const { storagePrefix } = (await res.json()) as { storagePrefix: string };
  onProgress?.({ step: 'done', bytesUploaded, bytesTotal });
  return { storagePrefix };
}

export interface BulkUploadProgress {
  done: number;
  total: number;
  currentId: string | null;
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Serially upload many local recordings. Single failures don't stop the loop —
 * they're collected into `failed[]` and reported via onProgress + final return.
 */
export async function uploadMany(
  recordingIds: string[],
  onProgress?: (p: BulkUploadProgress) => void,
): Promise<BulkUploadProgress> {
  const state: BulkUploadProgress = {
    done: 0,
    total: recordingIds.length,
    currentId: null,
    ok: [],
    failed: [],
  };
  onProgress?.({ ...state });
  for (const id of recordingIds) {
    state.currentId = id;
    onProgress?.({ ...state });
    try {
      await uploadRecording(id);
      state.ok.push(id);
    } catch (err) {
      state.failed.push({ id, error: err instanceof Error ? err.message : 'unknown' });
    }
    state.done += 1;
    onProgress?.({ ...state });
  }
  state.currentId = null;
  onProgress?.({ ...state });
  return state;
}

export async function listCloudRecordings(): Promise<CloudRecording[]> {
  const res = await fetch('/api/recordings/list', { cache: 'no-store' });
  if (!res.ok) throw new Error(`list_failed: ${res.status}`);
  const { recordings } = (await res.json()) as { recordings: CloudRecording[] };
  return recordings ?? [];
}

export async function updateCloudRecordingTitle(
  recordingId: string,
  title: string | null,
): Promise<void> {
  const res = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message ?? j.error ?? `patch_failed: ${res.status}`);
  }
}

export async function removeCloudRecording(recordingId: string): Promise<void> {
  const res = await fetch(`/api/recordings/${encodeURIComponent(recordingId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message ?? j.error ?? `delete_failed: ${res.status}`);
  }
}

/**
 * Download a cloud recording into the local IndexedDB so all existing
 * play/export code paths work unmodified.
 */
export async function importCloudRecording(
  recordingId: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const userId = await ensureUserId();
  const supabase = createClient();
  const db = getClientDb();

  const fetchObj = async (name: string): Promise<Blob | null> => {
    const path = pathFor(userId, recordingId, name);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) {
      // 404 / not found is fine for optional files (camera, audio)
      return null;
    }
    return data;
  };

  onProgress?.({ step: 'metadata', bytesUploaded: 0, bytesTotal: 0 });
  const metaBlob = await fetchObj('metadata.json');
  if (!metaBlob) throw new Error('cloud_recording_missing_metadata');
  const metaJson = JSON.parse(await metaBlob.text()) as RecordingMetadata & {
    binaryFileIds?: string[];
  };

  onProgress?.({ step: 'snapshots', bytesUploaded: metaBlob.size, bytesTotal: 0 });
  const snapsBlob = await fetchObj('snapshots.json.gz');
  if (!snapsBlob) throw new Error('cloud_recording_missing_snapshots');
  const snapsText = await gunzipToString(snapsBlob);
  const snapsObj = JSON.parse(snapsText) as {
    snapshots: WhiteboardSnapshot[];
    binaryFiles?: Array<{ fileId: string; data: unknown }>;
  };

  onProgress?.({ step: 'audio', bytesUploaded: 0, bytesTotal: 0 });
  const audioBlob = metaJson.hasAudio ? await fetchObj('audio.webm') : null;
  onProgress?.({ step: 'camera', bytesUploaded: 0, bytesTotal: 0 });
  const cameraBlob = metaJson.hasCamera ? await fetchObj('camera.webm') : null;

  // cameraPositions.json.gz —— 缺失时按空数组（老的云端录制没有这个文件）
  // schemaVersion 1: 无 hidden 字段；schemaVersion 2: 有 hidden（软静音）。
  onProgress?.({ step: 'cameraPositions', bytesUploaded: 0, bytesTotal: 0 });
  let cameraEvents: Array<{ timestamp: number; rx: number; ry: number; rs: number; hidden?: boolean }> = [];
  const camPosBlob = await fetchObj('cameraPositions.json.gz');
  if (camPosBlob) {
    try {
      const camPosText = await gunzipToString(camPosBlob);
      const parsed = JSON.parse(camPosText) as {
        events?: Array<{ timestamp: number; rx: number; ry: number; rs: number; hidden?: boolean }>;
      };
      cameraEvents = parsed.events ?? [];
    } catch {
      // 兼容损坏文件 —— 当作没有
      cameraEvents = [];
    }
  }

  await db.transaction(
    'rw',
    [db.recordings, db.snapshots, db.audioChunks, db.cameraChunks, db.cameraPositions, db.binaryFiles],
    async () => {
      // Clear any old local row with the same id so we start clean
      await db.recordings.delete(recordingId);
      await db.snapshots.where('recordingId').equals(recordingId).delete();
      await db.audioChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraPositions.where('recordingId').equals(recordingId).delete();
      await db.binaryFiles.where('recordingId').equals(recordingId).delete();

      const metaRow: RecordingMetadata = {
        id: metaJson.id ?? recordingId,
        startedAt: metaJson.startedAt,
        durationMs: metaJson.durationMs,
        hasAudio: !!metaJson.hasAudio,
        hasCamera: !!metaJson.hasCamera,
        status: 'done',
        lastFrameThumbnail: metaJson.lastFrameThumbnail,
        title: metaJson.title,
        subtitleSrt: metaJson.subtitleSrt,
      };
      await db.recordings.put(metaRow);

      // Snapshots
      const snapRows = snapsObj.snapshots.map((s) => ({
        recordingId,
        timestamp: s.timestamp,
        elements: s.elements,
        appState: s.appState,
      }));
      if (snapRows.length > 0) await db.snapshots.bulkAdd(snapRows);

      // Binary files (image assets etc.)
      if (snapsObj.binaryFiles && snapsObj.binaryFiles.length > 0) {
        const binRows: BinaryFileEntry[] = snapsObj.binaryFiles.map((b) => ({
          recordingId,
          fileId: b.fileId,
          data: b.data,
        }));
        await db.binaryFiles.bulkAdd(binRows);
      }

      // Audio / Camera — store as single chunk
      if (audioBlob) {
        const audioRow: AudioChunk = { recordingId, index: 0, blob: audioBlob };
        await db.audioChunks.add(audioRow);
      }
      if (cameraBlob) {
        const camRow: CameraChunk = { recordingId, index: 0, blob: cameraBlob };
        await db.cameraChunks.add(camRow);
      }

      // Camera position events（含 v2 的 hidden 字段）
      if (cameraEvents.length > 0) {
        const posRows: CameraPositionEvent[] = cameraEvents.map((e) => ({
          recordingId,
          timestamp: e.timestamp,
          rx: e.rx,
          ry: e.ry,
          rs: e.rs,
          ...(e.hidden ? { hidden: true } : {}),
        }));
        await db.cameraPositions.bulkAdd(posRows);
      }
    },
  );

  // Defensive: ensure subtitle is mirrored via dedicated helper (also touches updatedAt etc.)
  if (metaJson.subtitleSrt) {
    await saveSubtitleSrt(recordingId, metaJson.subtitleSrt);
  }

  onProgress?.({ step: 'done', bytesUploaded: 0, bytesTotal: 0 });
}
