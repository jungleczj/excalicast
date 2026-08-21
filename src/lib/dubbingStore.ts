import 'server-only';

import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { LocalizedTimingSegment } from '@/types/recording';

export type DubbingJobStatus = 'pending' | 'running' | 'done' | 'failed';
export type DubbingLipSyncStatus = 'done' | 'skipped' | 'failed';
export type DubbingJobPhase = 'translating' | 'synthesizing' | 'decoding' | 'assembling' | 'uploading' | 'saving';
export type DubbingChunkStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DubbingJob {
  id: string;
  userId: string;
  recordingId: string;
  targetLang: 'en';
  sourceAudioHash: string;
  sourceSrt?: string;
  sourceSrtHash?: string;
  status: DubbingJobStatus;
  createdAt: number;
  updatedAt: number;
  audioAssetPath?: string;
  audioType?: string;
  cameraAssetPath?: string;
  cameraType?: string;
  translatedSrt?: string;
  localizedSrt?: string;
  timingMap?: LocalizedTimingSegment[];
  dubbedAudioPath?: string;
  dubbedAudioType?: string;
  lipSyncCameraPath?: string;
  lipSyncCameraType?: string;
  lipSync?: DubbingLipSyncStatus;
  provider?: string;
  voiceName?: string;
  voiceRegister?: 'masculine' | 'feminine' | 'uncertain';
  voiceConfidence?: number;
  billableCharacters?: number;
  synthesisChunkCount?: number;
  phase?: DubbingJobPhase;
  totalChunks?: number;
  completedChunks?: number;
  elapsedMs?: number;
  etaMs?: number;
  decoder?: string;
  fallbackReason?: string;
  error?: string;
}

export interface DubbingJobChunk {
  id: string;
  jobId: string;
  userId: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  textHash: string;
  voiceName: string;
  speechRate: string;
  status: DubbingChunkStatus;
  attemptCount: number;
  mp3Path?: string;
  durationMs?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const serverless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
const DATA_DIR = serverless ? '/tmp' : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'excalicast.db');
const RESULT_DIR = path.join(DATA_DIR, 'dubbing-results');
let sqlite: Database.Database | null = null;
let admin: SupabaseClient | null = null;

function useSupabase(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

function localDb(): Database.Database {
  if (sqlite) return sqlite;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dubbing_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_audio_hash TEXT NOT NULL,
      source_srt TEXT,
      source_srt_hash TEXT,
      status TEXT NOT NULL,
      audio_asset_path TEXT,
      audio_type TEXT,
      camera_asset_path TEXT,
      camera_type TEXT,
      translated_srt TEXT,
      localized_srt TEXT,
      timing_map TEXT,
      dubbed_audio_path TEXT,
      dubbed_audio_type TEXT,
      lip_sync_camera_path TEXT,
      lip_sync_camera_type TEXT,
      lip_sync TEXT,
      provider TEXT,
      voice_name TEXT,
      voice_register TEXT,
      voice_confidence REAL,
      billable_characters INTEGER,
      synthesis_chunk_count INTEGER,
      phase TEXT,
      total_chunks INTEGER,
      completed_chunks INTEGER,
      elapsed_ms INTEGER,
      eta_ms INTEGER,
      decoder TEXT,
      fallback_reason TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  const columns = new Set((sqlite.prepare('PRAGMA table_info(dubbing_jobs)').all() as Array<{ name: string }>).map((row) => row.name));
  const additions: Array<[string, string]> = [
    ['voice_name', 'TEXT'],
    ['localized_srt', 'TEXT'],
    ['timing_map', 'TEXT'],
    ['source_srt_hash', 'TEXT'],
    ['voice_register', 'TEXT'],
    ['voice_confidence', 'REAL'],
    ['billable_characters', 'INTEGER'],
    ['synthesis_chunk_count', 'INTEGER'],
    ['phase', 'TEXT'],
    ['total_chunks', 'INTEGER'],
    ['completed_chunks', 'INTEGER'],
    ['elapsed_ms', 'INTEGER'],
    ['eta_ms', 'INTEGER'],
    ['decoder', 'TEXT'],
    ['fallback_reason', 'TEXT'],
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) sqlite.exec(`ALTER TABLE dubbing_jobs ADD COLUMN ${name} ${type}`);
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dubbing_job_chunks (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text_content TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      voice_name TEXT NOT NULL,
      speech_rate TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      mp3_path TEXT,
      duration_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(job_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS dubbing_job_chunks_job_idx ON dubbing_job_chunks(job_id, chunk_index);
  `);
  return sqlite;
}

type StoredRow = {
  id: string; user_id: string; recording_id: string; target_lang: 'en';
  source_audio_hash: string; source_srt: string | null; source_srt_hash: string | null; status: DubbingJobStatus;
  audio_asset_path: string | null; audio_type: string | null;
  camera_asset_path: string | null; camera_type: string | null;
  translated_srt: string | null; localized_srt: string | null; timing_map: string | LocalizedTimingSegment[] | null;
  dubbed_audio_path: string | null; dubbed_audio_type: string | null;
  lip_sync_camera_path: string | null; lip_sync_camera_type: string | null;
  lip_sync: DubbingLipSyncStatus | null; provider: string | null; error: string | null;
  voice_name: string | null; voice_register: 'masculine' | 'feminine' | 'uncertain' | null;
  voice_confidence: number | null; billable_characters: number | null; synthesis_chunk_count: number | null;
  phase: DubbingJobPhase | null; total_chunks: number | null; completed_chunks: number | null;
  elapsed_ms: number | null; eta_ms: number | null; decoder: string | null; fallback_reason: string | null;
  created_at: string | number; updated_at: string | number;
};

function fromRow(row: StoredRow | null | undefined): DubbingJob | undefined {
  if (!row) return undefined;
  const time = (value: string | number) => typeof value === 'number' ? value : new Date(value).getTime();
  return {
    id: row.id, userId: row.user_id, recordingId: row.recording_id, targetLang: row.target_lang,
    sourceAudioHash: row.source_audio_hash, sourceSrt: row.source_srt ?? undefined,
    sourceSrtHash: row.source_srt_hash ?? undefined,
    status: row.status, createdAt: time(row.created_at), updatedAt: time(row.updated_at),
    audioAssetPath: row.audio_asset_path ?? undefined, audioType: row.audio_type ?? undefined,
    cameraAssetPath: row.camera_asset_path ?? undefined, cameraType: row.camera_type ?? undefined,
    translatedSrt: row.translated_srt ?? undefined,
    localizedSrt: row.localized_srt ?? undefined,
    timingMap: typeof row.timing_map === 'string'
      ? JSON.parse(row.timing_map) as LocalizedTimingSegment[]
      : row.timing_map ?? undefined,
    dubbedAudioPath: row.dubbed_audio_path ?? undefined, dubbedAudioType: row.dubbed_audio_type ?? undefined,
    lipSyncCameraPath: row.lip_sync_camera_path ?? undefined, lipSyncCameraType: row.lip_sync_camera_type ?? undefined,
    lipSync: row.lip_sync ?? undefined, provider: row.provider ?? undefined, error: row.error ?? undefined,
    voiceName: row.voice_name ?? undefined,
    voiceRegister: row.voice_register ?? undefined,
    voiceConfidence: row.voice_confidence ?? undefined,
    billableCharacters: row.billable_characters ?? undefined,
    synthesisChunkCount: row.synthesis_chunk_count ?? undefined,
    phase: row.phase ?? undefined,
    totalChunks: row.total_chunks ?? undefined,
    completedChunks: row.completed_chunks ?? undefined,
    elapsedMs: row.elapsed_ms ?? undefined,
    etaMs: row.eta_ms ?? undefined,
    decoder: row.decoder ?? undefined,
    fallbackReason: row.fallback_reason ?? undefined,
  };
}

function toRow(job: DubbingJob): StoredRow {
  return {
    id: job.id, user_id: job.userId, recording_id: job.recordingId, target_lang: job.targetLang,
    source_audio_hash: job.sourceAudioHash, source_srt: job.sourceSrt ?? null,
    source_srt_hash: job.sourceSrtHash ?? null, status: job.status,
    audio_asset_path: job.audioAssetPath ?? null, audio_type: job.audioType ?? null,
    camera_asset_path: job.cameraAssetPath ?? null, camera_type: job.cameraType ?? null,
    translated_srt: job.translatedSrt ?? null,
    localized_srt: job.localizedSrt ?? null,
    timing_map: job.timingMap ?? null,
    dubbed_audio_path: job.dubbedAudioPath ?? null, dubbed_audio_type: job.dubbedAudioType ?? null,
    lip_sync_camera_path: job.lipSyncCameraPath ?? null, lip_sync_camera_type: job.lipSyncCameraType ?? null,
    lip_sync: job.lipSync ?? null, provider: job.provider ?? null, error: job.error ?? null,
    voice_name: job.voiceName ?? null,
    voice_register: job.voiceRegister ?? null,
    voice_confidence: job.voiceConfidence ?? null,
    billable_characters: job.billableCharacters ?? null,
    synthesis_chunk_count: job.synthesisChunkCount ?? null,
    phase: job.phase ?? null,
    total_chunks: job.totalChunks ?? null,
    completed_chunks: job.completedChunks ?? null,
    elapsed_ms: job.elapsedMs ?? null,
    eta_ms: job.etaMs ?? null,
    decoder: job.decoder ?? null,
    fallback_reason: job.fallbackReason ?? null,
    created_at: job.createdAt, updated_at: job.updatedAt,
  };
}

function dubbingStoreError(prefix: string, error: { code?: string; message: string }): Error {
  return Object.assign(new Error(`${prefix}: ${error.message}`), { code: error.code });
}

export async function createDubbingJob(job: DubbingJob): Promise<void> {
  const row = toRow(job);
  if (useSupabase()) {
    const { error } = await supabaseAdmin().from('dubbing_jobs').insert({
      ...row,
      created_at: new Date(job.createdAt).toISOString(),
      updated_at: new Date(job.updatedAt).toISOString(),
    });
    if (error) throw dubbingStoreError('create_dubbing_job', error);
    return;
  }
  const keys = Object.keys(row);
  localDb().prepare(`INSERT INTO dubbing_jobs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((key) => key === 'timing_map' && row.timing_map ? JSON.stringify(row.timing_map) : row[key as keyof StoredRow]));
}

export async function getDubbingJob(id: string, userId: string): Promise<DubbingJob | undefined> {
  if (useSupabase()) {
    const { data, error } = await supabaseAdmin()
      .from('dubbing_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw dubbingStoreError('get_dubbing_job', error);
    return fromRow(data as StoredRow | null);
  }
  return fromRow(localDb().prepare('SELECT * FROM dubbing_jobs WHERE id = ? AND user_id = ?').get(id, userId) as StoredRow | undefined);
}

export async function findReusableDubbingJob(
  userId: string,
  sourceAudioHash: string,
  sourceSrtHash: string,
  voiceName: string,
): Promise<DubbingJob | undefined> {
  if (useSupabase()) {
    const { data, error } = await supabaseAdmin().from('dubbing_jobs').select('*')
      .eq('user_id', userId).eq('source_audio_hash', sourceAudioHash).eq('source_srt_hash', sourceSrtHash)
      .eq('voice_name', voiceName).in('status', ['pending', 'running', 'done'])
      .order('created_at', { ascending: false }).limit(5);
    if (error) throw dubbingStoreError('find_reusable_dubbing_job', error);
    const candidates = (data as StoredRow[]).map(fromRow).filter((job): job is DubbingJob => !!job);
    return candidates.find((job) => job.status !== 'done' || (job.decoder === 'mpg123-wasm' && !!job.dubbedAudioPath));
  }
  const rows = localDb().prepare(
    `SELECT * FROM dubbing_jobs WHERE user_id = ? AND source_audio_hash = ? AND source_srt_hash = ? AND voice_name = ? AND status IN ('pending','running','done') ORDER BY created_at DESC LIMIT 5`,
  ).all(userId, sourceAudioHash, sourceSrtHash, voiceName) as StoredRow[];
  return rows.map(fromRow).filter((job): job is DubbingJob => !!job)
    .find((job) => job.status !== 'done' || (job.decoder === 'mpg123-wasm' && !!job.dubbedAudioPath));
}

export async function updateDubbingJob(id: string, userId: string, patch: Partial<Omit<DubbingJob, 'id' | 'userId'>>): Promise<DubbingJob | undefined> {
  const current = await getDubbingJob(id, userId);
  if (!current) return undefined;
  const next = { ...current, ...patch, id, updatedAt: Date.now() };
  const row = toRow(next);
  const mutable = Object.entries(row).filter(([key]) => key !== 'id');
  if (useSupabase()) {
    const body = Object.fromEntries(mutable);
    body.updated_at = new Date(next.updatedAt).toISOString();
    body.created_at = new Date(next.createdAt).toISOString();
    const { error } = await supabaseAdmin().from('dubbing_jobs').update(body).eq('id', id).eq('user_id', userId);
    if (error) throw dubbingStoreError('update_dubbing_job', error);
  } else {
    localDb().prepare(`UPDATE dubbing_jobs SET ${mutable.map(([key]) => `${key} = ?`).join(',')} WHERE id = ? AND user_id = ?`)
      .run(...mutable.map(([key, value]) => key === 'timing_map' && value ? JSON.stringify(value) : value), id, userId);
  }
  return next;
}

export async function touchDubbingJob(id: string, userId: string): Promise<void> {
  const updatedAt = Date.now();
  if (useSupabase()) {
    const { error } = await supabaseAdmin()
      .from('dubbing_jobs')
      .update({ updated_at: new Date(updatedAt).toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw dubbingStoreError('touch_dubbing_job', error);
    return;
  }
  localDb().prepare('UPDATE dubbing_jobs SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(updatedAt, id, userId);
}

type StoredChunkRow = {
  id: string; job_id: string; user_id: string; chunk_index: number; start_ms: number; end_ms: number;
  text_content: string; text_hash: string; voice_name: string; speech_rate: string; status: DubbingChunkStatus;
  attempt_count: number; mp3_path: string | null; duration_ms: number | null; error: string | null;
  created_at: string | number; updated_at: string | number;
};

function chunkFromRow(row: StoredChunkRow): DubbingJobChunk {
  const time = (value: string | number) => typeof value === 'number' ? value : new Date(value).getTime();
  return {
    id: row.id, jobId: row.job_id, userId: row.user_id, index: row.chunk_index,
    startMs: row.start_ms, endMs: row.end_ms, text: row.text_content, textHash: row.text_hash,
    voiceName: row.voice_name, speechRate: row.speech_rate, status: row.status,
    attemptCount: row.attempt_count, mp3Path: row.mp3_path ?? undefined,
    durationMs: row.duration_ms ?? undefined, error: row.error ?? undefined,
    createdAt: time(row.created_at), updatedAt: time(row.updated_at),
  };
}

function chunkToRow(chunk: DubbingJobChunk): StoredChunkRow {
  return {
    id: chunk.id, job_id: chunk.jobId, user_id: chunk.userId, chunk_index: chunk.index,
    start_ms: chunk.startMs, end_ms: chunk.endMs, text_content: chunk.text, text_hash: chunk.textHash,
    voice_name: chunk.voiceName, speech_rate: chunk.speechRate, status: chunk.status,
    attempt_count: chunk.attemptCount, mp3_path: chunk.mp3Path ?? null,
    duration_ms: chunk.durationMs ?? null, error: chunk.error ?? null,
    created_at: chunk.createdAt, updated_at: chunk.updatedAt,
  };
}

export async function ensureDubbingJobChunks(chunks: DubbingJobChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  if (useSupabase()) {
    const rows = chunks.map((chunk) => ({
      ...chunkToRow(chunk),
      created_at: new Date(chunk.createdAt).toISOString(),
      updated_at: new Date(chunk.updatedAt).toISOString(),
    }));
    const { error } = await supabaseAdmin().from('dubbing_job_chunks').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw dubbingStoreError('ensure_dubbing_job_chunks', error);
    return;
  }
  const sql = `INSERT OR IGNORE INTO dubbing_job_chunks (${Object.keys(chunkToRow(chunks[0])).join(',')}) VALUES (${Object.keys(chunkToRow(chunks[0])).map(() => '?').join(',')})`;
  const statement = localDb().prepare(sql);
  const transaction = localDb().transaction((values: DubbingJobChunk[]) => {
    for (const chunk of values) {
      const row = chunkToRow(chunk);
      statement.run(...Object.values(row));
    }
  });
  transaction(chunks);
}

export async function listDubbingJobChunks(jobId: string, userId: string): Promise<DubbingJobChunk[]> {
  if (useSupabase()) {
    const { data, error } = await supabaseAdmin().from('dubbing_job_chunks').select('*')
      .eq('job_id', jobId).eq('user_id', userId).order('chunk_index');
    if (error) throw dubbingStoreError('list_dubbing_job_chunks', error);
    return (data as StoredChunkRow[]).map(chunkFromRow);
  }
  return (localDb().prepare('SELECT * FROM dubbing_job_chunks WHERE job_id = ? AND user_id = ? ORDER BY chunk_index').all(jobId, userId) as StoredChunkRow[]).map(chunkFromRow);
}

export async function findReusableDubbingJobChunks(
  userId: string,
  keys: Array<{ textHash: string; voiceName: string; speechRate: string }>,
): Promise<Map<string, DubbingJobChunk>> {
  const cacheKey = (value: { textHash: string; voiceName: string }) =>
    `${value.textHash}:${value.voiceName}`;
  if (keys.length === 0) return new Map();
  let rows: StoredChunkRow[];
  if (useSupabase()) {
    const { data, error } = await supabaseAdmin().from('dubbing_job_chunks').select('*')
      .eq('user_id', userId).eq('status', 'done').in('text_hash', [...new Set(keys.map((key) => key.textHash))]);
    if (error) throw dubbingStoreError('find_reusable_dubbing_job_chunks', error);
    rows = data as StoredChunkRow[];
  } else {
    const hashes = [...new Set(keys.map((key) => key.textHash))];
    const placeholders = hashes.map(() => '?').join(',');
    rows = localDb().prepare(
      `SELECT * FROM dubbing_job_chunks WHERE user_id = ? AND status = 'done' AND text_hash IN (${placeholders})`,
    ).all(userId, ...hashes) as StoredChunkRow[];
  }
  const requested = new Set(keys.map(cacheKey));
  const reusable = new Map<string, DubbingJobChunk>();
  for (const row of rows) {
    const chunk = chunkFromRow(row);
    const key = cacheKey(chunk);
    if (requested.has(key) && chunk.mp3Path && !reusable.has(key)) reusable.set(key, chunk);
  }
  return reusable;
}

export async function updateDubbingJobChunk(
  id: string,
  userId: string,
  patch: Partial<Pick<DubbingJobChunk, 'status' | 'attemptCount' | 'mp3Path' | 'durationMs' | 'speechRate' | 'error'>>,
): Promise<void> {
  const mapping: Record<string, string> = {
    status: 'status', attemptCount: 'attempt_count', mp3Path: 'mp3_path', durationMs: 'duration_ms', speechRate: 'speech_rate', error: 'error',
  };
  const now = Date.now();
  const body = Object.fromEntries(Object.entries(patch).map(([key, value]) => [mapping[key], value ?? null]));
  if (useSupabase()) {
    const { error } = await supabaseAdmin().from('dubbing_job_chunks').update({ ...body, updated_at: new Date(now).toISOString() })
      .eq('id', id).eq('user_id', userId);
    if (error) throw dubbingStoreError('update_dubbing_job_chunk', error);
    return;
  }
  const entries = Object.entries(body);
  if (entries.length === 0) return;
  localDb().prepare(`UPDATE dubbing_job_chunks SET ${entries.map(([key]) => `${key} = ?`).join(',')}, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...entries.map(([, value]) => value), now, id, userId);
}

export async function saveLocalDubbingAsset(jobId: string, name: string, bytes: Uint8Array): Promise<string> {
  await fsPromises.mkdir(RESULT_DIR, { recursive: true });
  const safe = name.replace(/[^a-z0-9_.-]/gi, '_');
  const file = path.join(RESULT_DIR, `${jobId}-${safe}`);
  await fsPromises.writeFile(file, bytes);
  return file;
}

export async function readLocalDubbingAsset(file: string): Promise<Uint8Array | null> {
  if (!file.startsWith(RESULT_DIR + path.sep)) return null;
  try { return new Uint8Array(await fsPromises.readFile(file)); } catch { return null; }
}
