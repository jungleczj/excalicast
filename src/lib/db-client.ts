'use client';

import Dexie, { type Table } from 'dexie';
import type {
  AudioChunk,
  BinaryFileEntry,
  CameraChunk,
  CameraPositionEvent,
  LaserEvent,
  RecordingMetadata,
  ShellCanvasRect,
  ShellSize,
  WhiteboardSnapshot,
  WorkspaceShellRow,
} from '@/types/recording';

interface SnapshotRow extends WhiteboardSnapshot {
  id?: number;
  recordingId: string;
}

interface AudioChunkRow extends AudioChunk {
  id?: number;
}

interface CameraChunkRow extends CameraChunk {
  id?: number;
}

interface CameraPositionRow extends CameraPositionEvent {
  id?: number;
}

interface LaserEventRow extends LaserEvent {
  id?: number;
}

interface BinaryFileRow extends BinaryFileEntry {
  id?: number;
}

class ExcalicastDB extends Dexie {
  recordings!: Table<RecordingMetadata, string>;
  snapshots!: Table<SnapshotRow, number>;
  audioChunks!: Table<AudioChunkRow, number>;
  cameraChunks!: Table<CameraChunkRow, number>;
  cameraPositions!: Table<CameraPositionRow, number>;
  binaryFiles!: Table<BinaryFileRow, number>;
  workspaceShells!: Table<WorkspaceShellRow, number>;
  libraryItems!: Table<LibraryItemRow, string>;
  laserEvents!: Table<LaserEventRow, number>;

  constructor() {
    super('excalicast');
    this.version(1).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
    });
    this.version(2).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
    }).upgrade(async (tx) => {
      await tx.table('recordings').toCollection().modify((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        delete r.width;
        delete r.height;
        delete r.fps;
        if (r.lastFrameThumbnail === undefined) r.lastFrameThumbnail = null;
      });
    });
    // v3: 增加 cameraChunks 表 + recordings.hasCamera 字段
    this.version(3).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
    }).upgrade(async (tx) => {
      await tx.table('recordings').toCollection().modify((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        if (r.hasCamera === undefined) r.hasCamera = false;
      });
    });
    // v4: recordings.subtitleSrt（嵌入 SRT 文本，~10-50KB，行内存）
    this.version(4).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
    }).upgrade(async (tx) => {
      await tx.table('recordings').toCollection().modify((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        if (r.subtitleSrt === undefined) r.subtitleSrt = null;
      });
    });
    // v5: workspaceShells 表（录制期间捕获的 Excalicast 工作区 DOM 快照）
    this.version(5).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
    });
    // v6: cameraPositions 表（摄像头气泡随时间位置变化）。无 .upgrade —
    // 老录制没有事件，回放/导出会回退到右下角静态位置。
    this.version(6).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
    });
    // v7: libraryItems 表 —— 项目自家 library 持久化，
    // 跨浏览器 / 清缓存不丢，全部录制共用一份。
    this.version(7).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
    });
    // v8: laserEvents 表（激光笔轨迹随时间事件）。无 .upgrade —— 老录制空表，
    // 导出/回放都按"无激光"处理。
    this.version(8).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
    });
  }
}

let _db: ExcalicastDB | null = null;
export function getClientDb(): ExcalicastDB {
  if (!_db) _db = new ExcalicastDB();
  return _db;
}

export async function listRecordings(): Promise<RecordingMetadata[]> {
  const db = getClientDb();
  return db.recordings.orderBy('startedAt').reverse().toArray();
}

export async function getRecording(recordingId: string): Promise<RecordingMetadata | undefined> {
  return getClientDb().recordings.get(recordingId);
}

export async function updateRecordingTitle(recordingId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  await getClientDb().recordings.update(recordingId, {
    title: trimmed.length > 0 ? trimmed : undefined,
  });
}

export async function saveSubtitleSrt(recordingId: string, srt: string): Promise<void> {
  await getClientDb().recordings.update(recordingId, { subtitleSrt: srt });
}

export async function clearSubtitleSrt(recordingId: string): Promise<void> {
  await getClientDb().recordings.update(recordingId, { subtitleSrt: undefined });
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const db = getClientDb();
  await db.transaction(
    'rw',
    [db.recordings, db.snapshots, db.audioChunks, db.cameraChunks, db.cameraPositions, db.binaryFiles, db.workspaceShells, db.laserEvents],
    async () => {
      await db.recordings.delete(recordingId);
      await db.snapshots.where('recordingId').equals(recordingId).delete();
      await db.audioChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraPositions.where('recordingId').equals(recordingId).delete();
      await db.binaryFiles.where('recordingId').equals(recordingId).delete();
      await db.workspaceShells.where('recordingId').equals(recordingId).delete();
      await db.laserEvents.where('recordingId').equals(recordingId).delete();
    },
  );
}

export async function appendWorkspaceShell(params: {
  recordingId: string;
  timestamp: number;
  png: Blob;
  canvasRect: ShellCanvasRect;
  shellSize: ShellSize;
  hash: string;
}): Promise<void> {
  await getClientDb().workspaceShells.add(params);
}

export async function getWorkspaceShells(recordingId: string): Promise<WorkspaceShellRow[]> {
  return getClientDb().workspaceShells
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');
}

export async function countWorkspaceShells(recordingId: string): Promise<number> {
  return getClientDb().workspaceShells
    .where('recordingId').equals(recordingId)
    .count();
}

export async function loadFullRecording(recordingId: string): Promise<{
  metadata: RecordingMetadata;
  snapshots: WhiteboardSnapshot[];
  audioBlob: Blob | null;
  cameraBlob: Blob | null;
  cameraEvents: CameraPositionEvent[];
  laserEvents: LaserEvent[];
  binaryFiles: BinaryFileEntry[];
}> {
  const db = getClientDb();
  const metadata = await db.recordings.get(recordingId);
  if (!metadata) throw new Error(`recording_not_found: ${recordingId}`);

  const snapshots = await db.snapshots
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');

  const audioRows = await db.audioChunks
    .where('recordingId').equals(recordingId)
    .sortBy('index');
  const audioBlob = audioRows.length > 0
    ? new Blob(audioRows.map((c) => c.blob), { type: audioRows[0].blob.type || 'audio/webm' })
    : null;

  const camRows = await db.cameraChunks
    .where('recordingId').equals(recordingId)
    .sortBy('index');
  const cameraBlob = camRows.length > 0
    ? new Blob(camRows.map((c) => c.blob), { type: camRows[0].blob.type || 'video/webm' })
    : null;

  const camPosRows = await db.cameraPositions
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');
  const cameraEvents: CameraPositionEvent[] = camPosRows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    rx: r.rx,
    ry: r.ry,
    rs: r.rs,
    ...(r.hidden ? { hidden: true } : {}),
  }));

  const laserRows = await db.laserEvents
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');
  const laserEvents: LaserEvent[] = laserRows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    x: r.x,
    y: r.y,
    button: r.button,
  }));

  const binaryFiles = await db.binaryFiles.where('recordingId').equals(recordingId).toArray();

  return { metadata, snapshots, audioBlob, cameraBlob, cameraEvents, laserEvents, binaryFiles };
}

export async function listLaserEvents(recordingId: string): Promise<LaserEvent[]> {
  const db = getClientDb();
  const rows = await db.laserEvents
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');
  return rows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    x: r.x,
    y: r.y,
    button: r.button,
  }));
}

export async function bulkAddLaserEvents(events: LaserEvent[]): Promise<void> {
  if (events.length === 0) return;
  await getClientDb().laserEvents.bulkAdd(events);
}

export async function listCameraEvents(recordingId: string): Promise<CameraPositionEvent[]> {
  const db = getClientDb();
  const rows = await db.cameraPositions
    .where('recordingId').equals(recordingId)
    .sortBy('timestamp');
  return rows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    rx: r.rx,
    ry: r.ry,
    rs: r.rs,
    ...(r.hidden ? { hidden: true } : {}),
  }));
}

export async function bulkAddCameraEvents(events: CameraPositionEvent[]): Promise<void> {
  if (events.length === 0) return;
  await getClientDb().cameraPositions.bulkAdd(events);
}

// ----------------------------------------------------------------------------
// Excalidraw library 持久化
// 跟 @excalidraw/excalidraw 的 LibraryItem 类型对应（用 unknown[] 装 elements
// 避免在这里硬绑死 Excalidraw 内部类型，减少 import 链）。
// ----------------------------------------------------------------------------

export interface LibraryItemRow {
  id: string;
  status: 'published' | 'unpublished';
  elements: unknown[];
  created: number;
  name?: string;
}

export async function getAllLibraryItems(): Promise<LibraryItemRow[]> {
  return getClientDb().libraryItems.orderBy('created').toArray();
}

/**
 * 用 Excalidraw 当前 library 全量覆盖 IDB —— Excalidraw 的 onLibraryChange 也是
 * 全量回调，没有增删粒度。直接 clear + bulkAdd 最干净。
 */
export async function replaceLibraryItems(items: LibraryItemRow[]): Promise<void> {
  const db = getClientDb();
  await db.transaction('rw', db.libraryItems, async () => {
    await db.libraryItems.clear();
    if (items.length > 0) await db.libraryItems.bulkAdd(items);
  });
}

export async function addLibraryItem(item: LibraryItemRow): Promise<void> {
  await getClientDb().libraryItems.put(item);
}

export async function removeLibraryItem(id: string): Promise<void> {
  await getClientDb().libraryItems.delete(id);
}
