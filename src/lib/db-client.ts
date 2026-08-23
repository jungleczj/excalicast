'use client';

import Dexie, { type Table } from 'dexie';
import { loadScreenRecordingBlob, removeRecordingMediaDirectory } from '@/services/recordingMediaStore';
import { nativeMediaSources, type NativeMediaSources } from '@/desktop/nativeMediaSource';
import type { MediaTaskRecord } from '@/services/mediaTaskDomain';
import type {
  AudioChunk,
  AutoZoomSegment,
  BinaryFileEntry,
  CameraChunk,
  CameraPositionEvent,
  CursorFocusTrack,
  EnhancedAudioTrack,
  HighlightEffectSegment,
  KeyPointMotionSegment,
  LaserEvent,
  LocalizedTrack,
  RecordingMetadata,
  RecordingLibrarySummary,
  ScreenChunk,
  SystemAudioChunk,
  ShellCanvasRect,
  ShellSize,
  TimeSegment,
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

interface ScreenChunkRow extends ScreenChunk {
  id?: number;
}

interface SystemAudioChunkRow extends SystemAudioChunk {
  id?: number;
}

interface CameraPositionRow extends CameraPositionEvent {
  id?: number;
}

interface LaserEventRow extends LaserEvent {
  id?: number;
}

interface LocalizedTrackRow extends LocalizedTrack {}

interface EnhancedAudioTrackRow extends EnhancedAudioTrack {}

interface BinaryFileRow extends BinaryFileEntry {
  id?: number;
}

export interface ExportSegmentRow {
  id: string;
  taskId: string;
  recordingId: string;
  index: number;
  startMs: number;
  endMs: number;
  blob: Blob;
  createdAt: number;
}

export interface AudioPeakTrackRow {
  id: string;
  recordingId: string;
  sourceSignature: string;
  samplesPerSecond: number;
  peaks: number[];
  createdAt: number;
}

export interface RecordingThumbnailRow {
  recordingId: string;
  blob: Blob;
  updatedAt: number;
}

export interface AutoEditCacheRow {
  id: string;
  recordingId: string;
  analyzerVersion: string;
  variant: string;
  value: unknown;
  updatedAt: number;
}

class ExcalicastDB extends Dexie {
  recordings!: Table<RecordingMetadata, string>;
  snapshots!: Table<SnapshotRow, number>;
  audioChunks!: Table<AudioChunkRow, number>;
  cameraChunks!: Table<CameraChunkRow, number>;
  screenChunks!: Table<ScreenChunkRow, number>;
  systemAudioChunks!: Table<SystemAudioChunkRow, number>;
  cameraPositions!: Table<CameraPositionRow, number>;
  binaryFiles!: Table<BinaryFileRow, number>;
  workspaceShells!: Table<WorkspaceShellRow, number>;
  libraryItems!: Table<LibraryItemRow, string>;
  laserEvents!: Table<LaserEventRow, number>;
  localizedTracks!: Table<LocalizedTrackRow, string>;
  cursorFocusTracks!: Table<CursorFocusTrack, string>;
  mediaTasks!: Table<MediaTaskRecord, string>;
  exportSegments!: Table<ExportSegmentRow, string>;
  audioPeakTracks!: Table<AudioPeakTrackRow, string>;
  recordingThumbnails!: Table<RecordingThumbnailRow, string>;
  autoEditCaches!: Table<AutoEditCacheRow, string>;
  enhancedAudioTracks!: Table<EnhancedAudioTrackRow, string>;

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
    // v9: recordings 增加 ownerKey（按用户隔离本地录制库）。旧行 ownerKey 留空（legacy），
    // 首次被当前用户列出时认领。无需 .upgrade 迁移。
    this.version(9).stores({
      recordings: 'id, startedAt, status, ownerKey',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
    });
    // v10: screenChunks 表（本标签页/窗口/桌面/选区显示源录制）。
    this.version(10).stores({
      recordings: 'id, startedAt, status, ownerKey',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
    });
    // v11: localizedTracks 表 —— 英文配音/字幕/lip-sync 人像作为本地非破坏性资产。
    this.version(11).stores({
      recordings: 'id, startedAt, status, ownerKey',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
    });
    // v12: 光标识别产生的本地派生焦点轨迹。云端不上传，源视频恢复后可重新生成。
    this.version(12).stores({
      recordings: 'id, startedAt, status, ownerKey',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
      cursorFocusTracks: 'recordingId, analyzedAt, detectorVersion',
    });
    // v13: 可恢复的本地媒体任务、分段导出检查点和音频波形派生缓存。
    // 大媒体本身仍只保存在本机 IndexedDB，不上传到任务服务。
    this.version(13).stores({
      recordings: 'id, startedAt, status, ownerKey',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
      cursorFocusTracks: 'recordingId, analyzedAt, detectorVersion',
      mediaTasks: 'id, recordingId, kind, status, updatedAt, [recordingId+kind]',
      exportSegments: 'id, taskId, recordingId, index, [taskId+index]',
      audioPeakTracks: 'id, recordingId, sourceSignature, createdAt',
    });
    // v14: library metadata stays lightweight. Thumbnails and ChatCut results are
    // derived local assets and can be regenerated without touching source media.
    this.version(14).stores({
      recordings: 'id, startedAt, status, ownerKey, [ownerKey+startedAt]',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
      cursorFocusTracks: 'recordingId, analyzedAt, detectorVersion',
      mediaTasks: 'id, recordingId, kind, status, updatedAt, [recordingId+kind]',
      exportSegments: 'id, taskId, recordingId, index, [taskId+index]',
      audioPeakTracks: 'id, recordingId, sourceSignature, createdAt',
      recordingThumbnails: 'recordingId, updatedAt',
      autoEditCaches: 'id, recordingId, analyzerVersion, updatedAt, [recordingId+analyzerVersion]',
    }).upgrade(async (tx) => {
      const recordings = tx.table<RecordingMetadata, string>('recordings');
      const thumbnails = tx.table<RecordingThumbnailRow, string>('recordingThumbnails');
      const rows = await recordings.toArray();
      for (const row of rows) {
        const legacyThumbnail = row.lastFrameThumbnail;
        if (legacyThumbnail?.startsWith('data:')) {
          const blob = thumbnailDataUrlToBlob(legacyThumbnail);
          if (blob) await thumbnails.put({ recordingId: row.id, blob, updatedAt: Date.now() });
        }
        if ('lastFrameThumbnail' in row) {
          delete row.lastFrameThumbnail;
          await recordings.put(row);
        }
      }
    });
    // v15: locally derived microphone enhancement tracks. Source audio remains
    // immutable and the active derivative is referenced from recording metadata.
    this.version(15).stores({
      recordings: 'id, startedAt, status, ownerKey, [ownerKey+startedAt]',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
      cursorFocusTracks: 'recordingId, analyzedAt, detectorVersion',
      mediaTasks: 'id, recordingId, kind, status, updatedAt, [recordingId+kind]',
      exportSegments: 'id, taskId, recordingId, index, [taskId+index]',
      audioPeakTracks: 'id, recordingId, sourceSignature, createdAt',
      recordingThumbnails: 'recordingId, updatedAt',
      autoEditCaches: 'id, recordingId, analyzerVersion, updatedAt, [recordingId+analyzerVersion]',
      enhancedAudioTracks: 'id, recordingId, sourceFingerprint, mode, status, createdAt, [recordingId+sourceFingerprint]',
    });
    // v16: computer/system audio is a first-class source track. It must not be
    // embedded in screen video because preview/export decode video independently.
    this.version(16).stores({
      recordings: 'id, startedAt, status, ownerKey, [ownerKey+startedAt]',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      systemAudioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      screenChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
      libraryItems: 'id, status, created',
      laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
      localizedTracks: 'id, recordingId, targetLang, status, createdAt, [recordingId+targetLang]',
      cursorFocusTracks: 'recordingId, analyzedAt, detectorVersion',
      mediaTasks: 'id, recordingId, kind, status, updatedAt, [recordingId+kind]',
      exportSegments: 'id, taskId, recordingId, index, [taskId+index]',
      audioPeakTracks: 'id, recordingId, sourceSignature, createdAt',
      recordingThumbnails: 'recordingId, updatedAt',
      autoEditCaches: 'id, recordingId, analyzerVersion, updatedAt, [recordingId+analyzerVersion]',
      enhancedAudioTracks: 'id, recordingId, sourceFingerprint, mode, status, createdAt, [recordingId+sourceFingerprint]',
    });
  }
}

let _db: ExcalicastDB | null = null;
export function getClientDb(): ExcalicastDB {
  if (!_db) _db = new ExcalicastDB();
  return _db;
}

export async function markRecordingInterruptionRequested(
  recordingId: string,
  requestedAt = Date.now(),
): Promise<void> {
  await getClientDb().recordings.update(recordingId, { interruptionRequestedAt: requestedAt });
}

export async function recoverUnfinishedRecordings(): Promise<number> {
  const db = getClientDb();
  const unfinished = await db.recordings.where('status').anyOf('recording', 'finalizing').toArray();
  if (unfinished.length === 0) return 0;
  const { recoverUnfinishedRecording } = await import('@/services/recordingRecovery');

  await db.transaction(
    'rw',
    [
      db.recordings,
      db.snapshots,
      db.audioChunks,
      db.systemAudioChunks,
      db.cameraChunks,
      db.screenChunks,
      db.cameraPositions,
    ],
    async () => {
      for (const recording of unfinished) {
        const [snapshots, audioChunks, systemAudioChunks, cameraChunks, screenChunks, cameraPositions] = await Promise.all([
          db.snapshots.where('recordingId').equals(recording.id).toArray(),
          db.audioChunks.where('recordingId').equals(recording.id).toArray(),
          db.systemAudioChunks.where('recordingId').equals(recording.id).toArray(),
          db.cameraChunks.where('recordingId').equals(recording.id).toArray(),
          db.screenChunks.where('recordingId').equals(recording.id).toArray(),
          db.cameraPositions.where('recordingId').equals(recording.id).toArray(),
        ]);
        const chunkIntervalMs = recording.mediaChunkIntervalMs ?? 250;
        const mediaChunkDuration = Math.max(
          ...audioChunks.map((chunk) => (chunk.index + 1) * chunkIntervalMs),
          ...systemAudioChunks.map((chunk) => (chunk.index + 1) * chunkIntervalMs),
          ...cameraChunks.map((chunk) => (chunk.index + 1) * chunkIntervalMs),
          ...screenChunks.map((chunk) => (chunk.index + 1) * chunkIntervalMs),
          recording.mediaStorage?.screen?.durationMs ?? 0,
          0,
        );
        const timedDuration = Math.max(
          ...snapshots.map((snapshot) => snapshot.timestamp),
          ...cameraPositions.map((position) => position.timestamp),
          0,
        );
        await db.recordings.put(recoverUnfinishedRecording(
          recording,
          Math.max(mediaChunkDuration, timedDuration),
        ));
      }
    },
  );
  return unfinished.length;
}

/**
 * 列出当前 ownerKey 的录制（按用户隔离）。
 * legacy（v9 前无 ownerKey 的旧录制）首次被列出时认领给当前 ownerKey。
 * Callers that render before auth settles can opt out of legacy claiming until the
 * owner is known. That keeps the guest library responsive without assigning legacy
 * recordings to the wrong owner.
 */
const legacyClaimedOwners = new Set<string>();

function legacyClaimStorageKey(ownerKey: string): string {
  return `excalicast:legacy-owner-claimed:v1:${ownerKey}`;
}

async function claimLegacyRecordingsOnce(ownerKey: string): Promise<void> {
  const marker = legacyClaimStorageKey(ownerKey);
  if (legacyClaimedOwners.has(marker)) return;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(marker) === '1') {
      legacyClaimedOwners.add(marker);
      return;
    }
  } catch {
    // Storage may be blocked; the in-memory marker still prevents repeated scans this session.
  }

  const db = getClientDb();
  const legacy = await db.recordings.filter((r) => !r.ownerKey).toArray();
  if (legacy.length > 0) {
    await db.recordings.bulkPut(legacy.map((r) => ({ ...r, ownerKey })));
  }
  legacyClaimedOwners.add(marker);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(marker, '1');
  } catch {
    // The completed scan remains memoized for this page session.
  }
}

function toLibrarySummary(row: RecordingMetadata): RecordingLibrarySummary {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    hasAudio: row.hasAudio,
    hasCamera: row.hasCamera,
    status: row.status,
    tags: row.tags,
  };
}

type RecordingSummaryPosition = Pick<RecordingLibrarySummary, 'startedAt' | 'id'>;

function compareLibrarySummary(a: RecordingSummaryPosition, b: RecordingSummaryPosition): number {
  return b.startedAt - a.startedAt || b.id.localeCompare(a.id);
}

interface RecordingSummaryCursor {
  startedAt: number;
  id: string;
}

function encodeRecordingSummaryCursor(item: RecordingLibrarySummary): string {
  return encodeURIComponent(JSON.stringify({ startedAt: item.startedAt, id: item.id }));
}

function decodeRecordingSummaryCursor(cursor: string | undefined): RecordingSummaryCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as Partial<RecordingSummaryCursor>;
    if (!Number.isFinite(parsed.startedAt) || typeof parsed.id !== 'string') return null;
    return { startedAt: parsed.startedAt as number, id: parsed.id };
  } catch {
    return null;
  }
}

export interface RecordingSummaryPage {
  items: RecordingLibrarySummary[];
  nextCursor: string | null;
  totalCount: number;
  totalMs: number;
}

/**
 * Lists local recording metadata through the ownerKey index. Media chunk tables are never read.
 * A compound owner/start index is intentionally deferred to a future schema migration, so the
 * owner's metadata rows are ordered in memory before applying the stable timestamp/id cursor.
 */
export async function listRecordingSummaries(
  ownerKey: string,
  options: { cursor?: string; limit?: number; claimLegacy?: boolean; signal?: AbortSignal } = {},
): Promise<RecordingSummaryPage> {
  const { signal } = options;
  if (signal?.aborted) throw new DOMException('Local library query cancelled', 'AbortError');
  if (options.claimLegacy !== false) await claimLegacyRecordingsOnce(ownerKey);
  const db = getClientDb();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 30)));
  const cursor = decodeRecordingSummaryCursor(options.cursor);
  const rows = await db.transaction('r', db.recordings, async () => {
    const transaction = Dexie.currentTransaction;
    const abort = () => transaction.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const rows: RecordingMetadata[] = [];
      await db.recordings
        .where('[ownerKey+startedAt]')
        .between([ownerKey, Dexie.minKey], [ownerKey, Dexie.maxKey], true, true)
        .reverse()
        .each((row) => { rows.push(row); });
      return rows;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  });
  const all = rows.map(toLibrarySummary).sort(compareLibrarySummary);
  const eligible = cursor
    ? all.filter((item) => compareLibrarySummary(item, cursor) > 0)
    : all;
  const items = eligible.slice(0, limit);
  return {
    items,
    nextCursor: eligible.length > limit && items.length > 0
      ? encodeRecordingSummaryCursor(items[items.length - 1])
      : null,
    totalCount: all.length,
    totalMs: all.reduce((sum, item) => sum + item.durationMs, 0),
  };
}

export async function listRecordings(ownerKey: string): Promise<RecordingMetadata[]> {
  await claimLegacyRecordingsOnce(ownerKey);
  const db = getClientDb();
  // 用 v9 的 ownerKey 索引查询，避免把其它账号的行读进内存，也不再回退返回 legacy。
  const rows = await db.recordings.where('ownerKey').equals(ownerKey).sortBy('startedAt');
  return rows.reverse(); // startedAt 降序（最新在前）
}

/** 校验某录制是否属于当前 ownerKey（legacy/无主视为允许，向后兼容）。 */
async function ownsRecording(recordingId: string, ownerKey: string): Promise<boolean> {
  const r = await getClientDb().recordings.get(recordingId);
  if (!r) return false;
  return !r.ownerKey || r.ownerKey === ownerKey;
}

/** 把某 ownerKey 的录制整体改归另一个（匿名→登录时把 guest 录制并入账户）。 */
export async function migrateRecordingsOwner(fromOwnerKey: string, toOwnerKey: string): Promise<void> {
  if (!fromOwnerKey || !toOwnerKey || fromOwnerKey === toOwnerKey) return;
  const db = getClientDb();
  const rows = await db.recordings.where('ownerKey').equals(fromOwnerKey).toArray();
  if (rows.length > 0) {
    await db.recordings.bulkPut(rows.map((r) => ({ ...r, ownerKey: toOwnerKey })));
  }
}

export async function getRecording(recordingId: string, ownerKey?: string): Promise<RecordingMetadata | undefined> {
  const r = await getClientDb().recordings.get(recordingId);
  if (!r) return undefined;
  // 传了 ownerKey 时按用户隔离：他人录制视为不存在（legacy/无主放行，向后兼容）。
  if (ownerKey && r.ownerKey && r.ownerKey !== ownerKey) return undefined;
  return r;
}

export async function updateRecordingTitle(recordingId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  await getClientDb().recordings.update(recordingId, {
    title: trimmed.length > 0 ? trimmed : undefined,
  });
}

export async function updateRecordingTags(recordingId: string, tags: string[]): Promise<void> {
  const clean = tags.map((s) => s.trim()).filter(Boolean).slice(0, 6);
  await getClientDb().recordings.update(recordingId, { tags: clean.length > 0 ? clean : undefined });
}

export async function updateRecordingSegments(recordingId: string, segments: TimeSegment[]): Promise<void> {
  // Array order is the edited playback order. Only discard invalid ranges.
  const clean = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((segment) => ({ start: Math.round(segment.start), end: Math.round(segment.end) }));
  await getClientDb().recordings.update(recordingId, { segments: clean.length > 0 ? clean : undefined });
  invalidateRecordingMediaCache(recordingId);
}

export async function updateRecordingMainTrack(
  recordingId: string,
  mainTrack: import('@/types/recording').MainTrackClip[],
): Promise<void> {
  const clean = mainTrack
    .filter((clip) => (
      typeof clip.id === 'string'
      && typeof clip.recordingId === 'string'
      && Number.isFinite(clip.sourceStart)
      && Number.isFinite(clip.sourceEnd)
      && clip.sourceEnd > clip.sourceStart
    ))
    .map((clip) => ({
      id: clip.id,
      recordingId: clip.recordingId,
      sourceStart: Math.max(0, Math.round(clip.sourceStart)),
      sourceEnd: Math.max(1, Math.round(clip.sourceEnd)),
      title: clip.title?.trim() || undefined,
    }));
  await getClientDb().recordings.update(recordingId, { mainTrack: clean.length > 0 ? clean : undefined });
  invalidateRecordingMediaCache(recordingId);
}

export async function updateRecordingAutoZooms(recordingId: string, autoZooms: AutoZoomSegment[]): Promise<void> {
  const clean = autoZooms
    .filter((z) => Number.isFinite(z.start) && Number.isFinite(z.end) && z.end > z.start && Number.isFinite(z.scale) && z.scale > 1)
    .map((z) => ({
      id: z.id,
      start: Math.max(0, Math.round(z.start)),
      end: Math.max(0, Math.round(z.end)),
      scale: Math.max(1.05, Math.min(4, Number(z.scale))),
      cx: Number.isFinite(z.cx) ? Math.max(0, Math.min(1, Number(z.cx))) : 0.5,
      cy: Number.isFinite(z.cy) ? Math.max(0, Math.min(1, Number(z.cy))) : 0.5,
    }))
    .sort((a, b) => a.start - b.start);
  await getClientDb().recordings.update(recordingId, { autoZooms: clean.length > 0 ? clean : undefined });
  invalidateRecordingMediaCache(recordingId);
}

export async function updateRecordingHighlights(recordingId: string, highlights: HighlightEffectSegment[]): Promise<void> {
  const clean = highlights
    .filter((item) => (
      Number.isFinite(item.start)
      && Number.isFinite(item.end)
      && item.end > item.start
      && Number.isFinite(item.region.x)
      && Number.isFinite(item.region.y)
      && Number.isFinite(item.region.width)
      && Number.isFinite(item.region.height)
    ))
    .map((item) => {
      const width = Math.max(0.02, Math.min(1, item.region.width));
      const height = Math.max(0.02, Math.min(1, item.region.height));
      return {
        ...item,
        start: Math.max(0, Math.round(item.start)),
        end: Math.max(0, Math.round(item.end)),
        region: {
          x: Math.max(0, Math.min(1 - width, item.region.x)),
          y: Math.max(0, Math.min(1 - height, item.region.y)),
          width,
          height,
        },
        spotlightOpacity: Math.max(0, Math.min(0.9, item.spotlightOpacity)),
        calloutText: item.calloutText?.trim().slice(0, 240) || undefined,
        transition: {
          ...item.transition,
          enterMs: Math.max(80, Math.min(2_000, Math.round(item.transition.enterMs))),
          exitMs: Math.max(80, Math.min(2_000, Math.round(item.transition.exitMs))),
        },
      };
    })
    .sort((a, b) => a.start - b.start);
  await getClientDb().recordings.update(recordingId, { highlights: clean.length > 0 ? clean : undefined });
}

function cleanKeyPointMotions(motions: KeyPointMotionSegment[]): KeyPointMotionSegment[] {
  return motions
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .map((item) => ({
      ...item,
      kind: item.kind === 'chapter_title' || item.kind === 'chapter_drawer' ? 'chapter_drawer' as const : 'key_points_drawer' as const,
      schemaVersion: 3 as const,
      start: Math.max(0, Math.round(item.start)),
      end: Math.max(0, Math.round(item.end)),
      sourceCueStart: Math.max(0, Math.round(item.sourceCueStart)),
      sourceCueEnd: Math.max(0, Math.round(item.sourceCueEnd)),
      title: item.title.trim().slice(0, 120),
      bullets: item.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, 4),
      lines: item.lines?.map((line, index) => ({
        id: line.id?.trim().slice(0, 160) || `${item.id}-line-${index}`,
        role: line.role === 'title' ? 'title' as const : 'point' as const,
        text: line.text.trim().slice(0, 120),
        anchorCueIndex: Math.max(0, Math.round(line.anchorCueIndex)),
        revealAtMs: Math.max(0, Math.round(line.revealAtMs)),
        matchKind: line.matchKind === 'exact' || line.matchKind === 'partial' || line.matchKind === 'semantic'
          ? line.matchKind
          : 'fallback' as const,
      })).filter((line) => line.text.length > 0),
      transition: {
        ...item.transition,
        enterMs: Math.max(80, Math.min(2_000, Math.round(item.transition.enterMs))),
        exitMs: Math.max(80, Math.min(2_000, Math.round(item.transition.exitMs))),
      },
    }))
    .filter((item) => item.title.length > 0)
    .sort((a, b) => a.start - b.start);
}

export async function updateRecordingKeyPointMotions(recordingId: string, motions: KeyPointMotionSegment[]): Promise<void> {
  const clean = cleanKeyPointMotions(motions);
  await getClientDb().recordings.update(recordingId, { keyPointMotions: clean.length > 0 ? clean : undefined });
}

export async function updateLocalizedTrackKeyPointMotions(trackId: string, motions: KeyPointMotionSegment[]): Promise<void> {
  const clean = cleanKeyPointMotions(motions);
  await getClientDb().localizedTracks.update(trackId, { keyPointMotions: clean.length > 0 ? clean : undefined });
}

export async function saveSubtitleSrt(recordingId: string, srt: string): Promise<void> {
  await getClientDb().recordings.update(recordingId, { subtitleSrt: srt });
  invalidateRecordingMediaCache(recordingId);
}

export async function clearSubtitleSrt(recordingId: string): Promise<void> {
  await getClientDb().recordings.update(recordingId, { subtitleSrt: undefined });
  invalidateRecordingMediaCache(recordingId);
}

export async function listLocalizedTracks(recordingId: string): Promise<LocalizedTrack[]> {
  return getClientDb().localizedTracks
    .where('recordingId').equals(recordingId)
    .sortBy('createdAt')
    .then((rows) => rows.reverse());
}

export async function getLocalizedTrack(trackId: string | null | undefined): Promise<LocalizedTrack | undefined> {
  if (!trackId) return undefined;
  return getClientDb().localizedTracks.get(trackId);
}

export async function saveLocalizedTrack(track: LocalizedTrack, activate = true): Promise<void> {
  const db = getClientDb();
  await db.transaction('rw', [db.localizedTracks, db.recordings], async () => {
    await db.localizedTracks.put(track);
    if (activate) await db.recordings.update(track.recordingId, { localizedTrackId: track.id });
  });
  invalidateRecordingMediaCache(track.recordingId);
}

export async function setActiveLocalizedTrack(recordingId: string, trackId: string | undefined): Promise<void> {
  await getClientDb().recordings.update(recordingId, { localizedTrackId: trackId });
  invalidateRecordingMediaCache(recordingId);
}

export async function listEnhancedAudioTracks(recordingId: string): Promise<EnhancedAudioTrack[]> {
  return getClientDb().enhancedAudioTracks.where('recordingId').equals(recordingId).sortBy('createdAt').then((rows) => rows.reverse());
}

export async function getEnhancedAudioTrack(trackId: string | null | undefined): Promise<EnhancedAudioTrack | undefined> {
  if (!trackId) return undefined;
  return getClientDb().enhancedAudioTracks.get(trackId);
}

export async function saveEnhancedAudioTrack(track: EnhancedAudioTrack, activate = true): Promise<void> {
  const db = getClientDb();
  await db.transaction('rw', [db.enhancedAudioTracks, db.recordings], async () => {
    await db.enhancedAudioTracks.put(track);
    if (activate && track.status === 'ready') {
      await db.recordings.update(track.recordingId, { activeEnhancedAudioTrackId: track.id });
    }
  });
  invalidateRecordingMediaCache(track.recordingId);
}

export async function setActiveEnhancedAudioTrack(recordingId: string, trackId: string | undefined): Promise<void> {
  await getClientDb().recordings.update(recordingId, { activeEnhancedAudioTrackId: trackId });
  invalidateRecordingMediaCache(recordingId);
}

export async function getCursorFocusTrack(recordingId: string): Promise<CursorFocusTrack | undefined> {
  return getClientDb().cursorFocusTracks.get(recordingId);
}

export async function saveCursorFocusTrack(track: CursorFocusTrack): Promise<void> {
  await getClientDb().cursorFocusTracks.put(track);
}

export async function deleteRecording(recordingId: string, ownerKey?: string): Promise<void> {
  const db = getClientDb();
  // 传了 ownerKey 时只允许删自己的（防同设备他号经 id 删除他人录制）。
  if (ownerKey && !(await ownsRecording(recordingId, ownerKey))) return;
  await db.transaction(
    'rw',
    [db.recordings, db.snapshots, db.audioChunks, db.systemAudioChunks, db.cameraChunks, db.screenChunks, db.cameraPositions, db.binaryFiles, db.workspaceShells, db.laserEvents, db.localizedTracks, db.cursorFocusTracks, db.mediaTasks, db.exportSegments, db.audioPeakTracks, db.recordingThumbnails, db.autoEditCaches, db.enhancedAudioTracks],
    async () => {
      await db.recordings.delete(recordingId);
      await db.snapshots.where('recordingId').equals(recordingId).delete();
      await db.audioChunks.where('recordingId').equals(recordingId).delete();
      await db.systemAudioChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraChunks.where('recordingId').equals(recordingId).delete();
      await db.screenChunks.where('recordingId').equals(recordingId).delete();
      await db.cameraPositions.where('recordingId').equals(recordingId).delete();
      await db.binaryFiles.where('recordingId').equals(recordingId).delete();
      await db.workspaceShells.where('recordingId').equals(recordingId).delete();
      await db.laserEvents.where('recordingId').equals(recordingId).delete();
      await db.localizedTracks.where('recordingId').equals(recordingId).delete();
      await db.cursorFocusTracks.delete(recordingId);
      await db.mediaTasks.where('recordingId').equals(recordingId).delete();
      await db.exportSegments.where('recordingId').equals(recordingId).delete();
      await db.audioPeakTracks.where('recordingId').equals(recordingId).delete();
      await db.recordingThumbnails.delete(recordingId);
      await db.autoEditCaches.where('recordingId').equals(recordingId).delete();
      await db.enhancedAudioTracks.where('recordingId').equals(recordingId).delete();
    },
  );
  await removeRecordingMediaDirectory(recordingId);
  invalidateRecordingMediaCache(recordingId);
}

export function thumbnailDataUrlToBlob(value: string): Blob | null {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  try {
    const mimeType = match[1] || 'image/jpeg';
    const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

export async function saveRecordingThumbnail(recordingId: string, thumbnail: Blob | string | null): Promise<void> {
  const db = getClientDb();
  if (!thumbnail) {
    await db.recordingThumbnails.delete(recordingId);
    return;
  }
  const blob = typeof thumbnail === 'string' ? thumbnailDataUrlToBlob(thumbnail) : thumbnail;
  if (!blob) return;
  await db.recordingThumbnails.put({ recordingId, blob, updatedAt: Date.now() });
}

export async function loadRecordingThumbnail(recordingId: string): Promise<Blob | null> {
  return (await getClientDb().recordingThumbnails.get(recordingId))?.blob ?? null;
}

export async function loadRecordingThumbnailDataUrl(recordingId: string): Promise<string | null> {
  const blob = await loadRecordingThumbnail(recordingId);
  if (!blob) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function saveMediaTask(task: MediaTaskRecord): Promise<void> {
  await getClientDb().mediaTasks.put(task);
}

export async function getMediaTask(taskId: string): Promise<MediaTaskRecord | undefined> {
  return getClientDb().mediaTasks.get(taskId);
}

export async function getLatestMediaTask(
  recordingId: string,
  kind: MediaTaskRecord['kind'],
): Promise<MediaTaskRecord | undefined> {
  const tasks = await getClientDb().mediaTasks.where('[recordingId+kind]').equals([recordingId, kind]).sortBy('updatedAt');
  return tasks.at(-1);
}

export async function listRecoverableMediaTasks(): Promise<MediaTaskRecord[]> {
  return getClientDb().mediaTasks
    .filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'paused')
    .sortBy('updatedAt');
}

export async function claimMediaTask(taskId: string, ownerId: string): Promise<MediaTaskRecord | undefined> {
  const db = getClientDb();
  return db.transaction('rw', db.mediaTasks, async () => {
    const task = await db.mediaTasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'cancelled') return undefined;
    const next: MediaTaskRecord = {
      ...task,
      ownerId,
      status: 'running',
      updatedAt: Date.now(),
      error: undefined,
    };
    await db.mediaTasks.put(next);
    return next;
  });
}

export async function saveExportSegment(segment: ExportSegmentRow): Promise<void> {
  await getClientDb().exportSegments.put(segment);
}

export async function listExportSegments(taskId: string): Promise<ExportSegmentRow[]> {
  return getClientDb().exportSegments.where('taskId').equals(taskId).sortBy('index');
}

export async function saveAudioPeakTrack(track: AudioPeakTrackRow): Promise<void> {
  await getClientDb().audioPeakTracks.put(track);
}

export async function getAudioPeakTrack(recordingId: string): Promise<AudioPeakTrackRow | undefined> {
  return getClientDb().audioPeakTracks.where('recordingId').equals(recordingId).last();
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

export interface FullRecording {
  metadata: RecordingMetadata;
  snapshots: WhiteboardSnapshot[];
  audioBlob: Blob | null;
  systemAudioBlob: Blob | null;
  cameraBlob: Blob | null;
  screenBlob: Blob | null;
  nativeMedia: NativeMediaSources | null;
  cameraEvents: CameraPositionEvent[];
  laserEvents: LaserEvent[];
  binaryFiles: BinaryFileEntry[];
  manifest: RecordingMediaManifest;
}

export interface RecordingMediaManifest {
  metadata: RecordingMetadata;
  audio: { chunks: number; bytes: number };
  systemAudio: { chunks: number; bytes: number };
  camera: { chunks: number; bytes: number };
  screen: { chunks: number; bytes: number };
}

export interface RecordingMediaTracks {
  metadata: RecordingMetadata;
  audioBlob: Blob | null;
  systemAudioBlob: Blob | null;
  cameraBlob: Blob | null;
  screenBlob: Blob | null;
  nativeMedia: NativeMediaSources | null;
}

const fullRecordingCache = new Map<string, Promise<FullRecording>>();
const FULL_RECORDING_CACHE_LIMIT = 3;

export function invalidateRecordingMediaCache(recordingId: string): void {
  for (const key of fullRecordingCache.keys()) {
    if (key.startsWith(`${recordingId}::`)) fullRecordingCache.delete(key);
  }
}

export const releaseRecordingMediaCache = invalidateRecordingMediaCache;

type RecordingAudioChunkLike = Pick<AudioChunk, 'recordingId' | 'index' | 'blob'>;

/**
 * Reassembles microphone and computer audio without collapsing their identity.
 * Keeping this boundary pure also makes legacy recordings (no system rows) an
 * explicit, testable case instead of relying on incidental Dexie behavior.
 */
export function assembleRecordingAudioTracks(
  audioRows: readonly RecordingAudioChunkLike[],
  systemAudioRows: readonly RecordingAudioChunkLike[],
): Pick<RecordingMediaTracks, 'audioBlob' | 'systemAudioBlob'> {
  const assemble = (rows: readonly RecordingAudioChunkLike[]): Blob | null => {
    if (rows.length === 0) return null;
    const ordered = [...rows].sort((left, right) => left.index - right.index);
    return new Blob(ordered.map((row) => row.blob), {
      type: ordered[0].blob.type || 'audio/webm',
    });
  };
  return {
    audioBlob: assemble(audioRows),
    systemAudioBlob: assemble(systemAudioRows),
  };
}

export async function loadRecordingMediaTracks(
  recordingId: string,
  tracks: ReadonlyArray<'audio' | 'systemAudio' | 'camera' | 'screen'>,
  ownerKey?: string,
): Promise<RecordingMediaTracks> {
  const db = getClientDb();
  const metadata = await db.recordings.get(recordingId);
  if (!metadata || (ownerKey && metadata.ownerKey && metadata.ownerKey !== ownerKey)) {
    throw new Error(`recording_not_found: ${recordingId}`);
  }
  const [audioRows, systemAudioRows, cameraRows, screenRows] = await Promise.all([
    tracks.includes('audio')
      ? db.audioChunks.where('recordingId').equals(recordingId).sortBy('index')
      : Promise.resolve([]),
    tracks.includes('systemAudio')
      ? db.systemAudioChunks.where('recordingId').equals(recordingId).sortBy('index')
      : Promise.resolve([]),
    tracks.includes('camera')
      ? db.cameraChunks.where('recordingId').equals(recordingId).sortBy('index')
      : Promise.resolve([]),
    tracks.includes('screen')
      ? db.screenChunks.where('recordingId').equals(recordingId).sortBy('index')
      : Promise.resolve([]),
  ]);
  const audioTracks = assembleRecordingAudioTracks(audioRows, systemAudioRows);
  return {
    metadata,
    nativeMedia: nativeMediaSources(metadata.nativeProject, typeof window !== 'undefined' && Boolean(window.excalicastDesktop)),
    ...audioTracks,
    cameraBlob: cameraRows.length > 0
      ? new Blob(cameraRows.map((row) => row.blob), { type: cameraRows[0].blob.type || 'video/webm' })
      : null,
    screenBlob: tracks.includes('screen')
      ? await loadScreenRecordingBlob({ manifest: metadata.mediaStorage, legacyChunks: screenRows })
      : null,
  };
}

export async function loadRecordingManifest(recordingId: string, ownerKey?: string): Promise<RecordingMediaManifest> {
  const db = getClientDb();
  const metadata = await db.recordings.get(recordingId);
  if (!metadata || (ownerKey && metadata.ownerKey && metadata.ownerKey !== ownerKey)) {
    throw new Error(`recording_not_found: ${recordingId}`);
  }
  const [audioRows, systemAudioRows, cameraRows, screenRows] = await Promise.all([
    db.audioChunks.where('recordingId').equals(recordingId).toArray(),
    db.systemAudioChunks.where('recordingId').equals(recordingId).toArray(),
    db.cameraChunks.where('recordingId').equals(recordingId).toArray(),
    db.screenChunks.where('recordingId').equals(recordingId).toArray(),
  ]);
  return {
    metadata,
    audio: { chunks: audioRows.length, bytes: audioRows.reduce((sum, row) => sum + row.blob.size, 0) },
    systemAudio: { chunks: systemAudioRows.length, bytes: systemAudioRows.reduce((sum, row) => sum + row.blob.size, 0) },
    camera: { chunks: cameraRows.length, bytes: cameraRows.reduce((sum, row) => sum + row.blob.size, 0) },
    screen: metadata.mediaStorage?.screen
      ? { chunks: metadata.mediaStorage.screen.fragments, bytes: metadata.mediaStorage.screen.bytes }
      : { chunks: screenRows.length, bytes: screenRows.reduce((sum, row) => sum + row.blob.size, 0) },
  };
}

async function loadFullRecordingUncached(recordingId: string, ownerKey?: string): Promise<FullRecording> {
  const db = getClientDb();
  const metadata = await db.recordings.get(recordingId);
  if (!metadata) throw new Error(`recording_not_found: ${recordingId}`);
  // 传了 ownerKey 时按用户隔离：他人录制按"不存在"处理（legacy/无主放行）。
  if (ownerKey && metadata.ownerKey && metadata.ownerKey !== ownerKey) {
    throw new Error(`recording_not_found: ${recordingId}`);
  }

  const [snapshots, audioRows, systemAudioRows, camRows, screenRows, camPosRows, laserRows, binaryFiles] = await Promise.all([
    db.snapshots.where('recordingId').equals(recordingId).sortBy('timestamp'),
    db.audioChunks.where('recordingId').equals(recordingId).sortBy('index'),
    db.systemAudioChunks.where('recordingId').equals(recordingId).sortBy('index'),
    db.cameraChunks.where('recordingId').equals(recordingId).sortBy('index'),
    db.screenChunks.where('recordingId').equals(recordingId).sortBy('index'),
    db.cameraPositions.where('recordingId').equals(recordingId).sortBy('timestamp'),
    db.laserEvents.where('recordingId').equals(recordingId).sortBy('timestamp'),
    db.binaryFiles.where('recordingId').equals(recordingId).toArray(),
  ]);
  const { audioBlob, systemAudioBlob } = assembleRecordingAudioTracks(audioRows, systemAudioRows);

  const cameraBlob = camRows.length > 0
    ? new Blob(camRows.map((c) => c.blob), { type: camRows[0].blob.type || 'video/webm' })
    : null;

  const screenBlob = await loadScreenRecordingBlob({
    manifest: metadata.mediaStorage,
    legacyChunks: screenRows,
  });

  const cameraEvents: CameraPositionEvent[] = camPosRows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    rx: r.rx,
    ry: r.ry,
    rs: r.rs,
    ...(r.placement ? { placement: r.placement } : {}),
    ...(r.hidden ? { hidden: true } : {}),
  }));

  const laserEvents: LaserEvent[] = laserRows.map((r) => ({
    recordingId: r.recordingId,
    timestamp: r.timestamp,
    x: r.x,
    y: r.y,
    button: r.button,
  }));

  const manifest: RecordingMediaManifest = {
    metadata,
    audio: { chunks: audioRows.length, bytes: audioRows.reduce((sum, row) => sum + row.blob.size, 0) },
    systemAudio: { chunks: systemAudioRows.length, bytes: systemAudioRows.reduce((sum, row) => sum + row.blob.size, 0) },
    camera: { chunks: camRows.length, bytes: camRows.reduce((sum, row) => sum + row.blob.size, 0) },
    screen: { chunks: screenRows.length, bytes: screenRows.reduce((sum, row) => sum + row.blob.size, 0) },
  };
  return {
    metadata,
    snapshots,
    audioBlob,
    systemAudioBlob,
    cameraBlob,
    screenBlob,
    nativeMedia: nativeMediaSources(metadata.nativeProject, typeof window !== 'undefined' && Boolean(window.excalicastDesktop)),
    cameraEvents,
    laserEvents,
    binaryFiles,
    manifest,
  };
}

export async function loadFullRecording(recordingId: string, ownerKey?: string): Promise<FullRecording> {
  const key = `${recordingId}::${ownerKey ?? ''}`;
  const cached = fullRecordingCache.get(key);
  if (cached) return cached;
  const pending = loadFullRecordingUncached(recordingId, ownerKey);
  fullRecordingCache.set(key, pending);
  while (fullRecordingCache.size > FULL_RECORDING_CACHE_LIMIT) {
    const oldest = fullRecordingCache.keys().next().value as string | undefined;
    if (!oldest || oldest === key) break;
    fullRecordingCache.delete(oldest);
  }
  try {
    return await pending;
  } catch (error) {
    fullRecordingCache.delete(key);
    throw error;
  }
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
    ...(r.placement ? { placement: r.placement } : {}),
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
