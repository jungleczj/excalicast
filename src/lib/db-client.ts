'use client';

import Dexie, { type Table } from 'dexie';
import type { RecordingMetadata, WhiteboardSnapshot, AudioChunk, CameraChunk, BinaryFileEntry } from '@/types/recording';

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

interface BinaryFileRow extends BinaryFileEntry {
  id?: number;
}

class ExcalicastDB extends Dexie {
  recordings!: Table<RecordingMetadata, string>;
  snapshots!: Table<SnapshotRow, number>;
  audioChunks!: Table<AudioChunkRow, number>;
  cameraChunks!: Table<CameraChunkRow, number>;
  binaryFiles!: Table<BinaryFileRow, number>;

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

export async function deleteRecording(recordingId: string): Promise<void> {
  const db = getClientDb();
  await db.transaction(
    'rw',
    [db.recordings, db.snapshots, db.audioChunks, db.cameraChunks, db.binaryFiles],
    async () => {
      await db.recordings.delete(recordingId);
      await db.snapshots.where('recordingId').equals(recordingId).delete();
      await db.audioChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraChunks.where('recordingId').equals(recordingId).delete();
      await db.binaryFiles.where('recordingId').equals(recordingId).delete();
    },
  );
}

export async function loadFullRecording(recordingId: string): Promise<{
  metadata: RecordingMetadata;
  snapshots: WhiteboardSnapshot[];
  audioBlob: Blob | null;
  cameraBlob: Blob | null;
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

  const binaryFiles = await db.binaryFiles.where('recordingId').equals(recordingId).toArray();

  return { metadata, snapshots, audioBlob, cameraBlob, binaryFiles };
}
