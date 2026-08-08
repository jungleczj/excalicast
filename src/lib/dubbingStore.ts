import 'server-only';

import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type DubbingJobStatus = 'pending' | 'running' | 'done' | 'failed';
export type DubbingLipSyncStatus = 'done' | 'skipped' | 'failed';

export interface DubbingJob {
  id: string;
  userId: string;
  recordingId: string;
  targetLang: 'en';
  sourceAudioHash: string;
  sourceSrt?: string;
  status: DubbingJobStatus;
  createdAt: number;
  updatedAt: number;
  audioAssetPath?: string;
  audioType?: string;
  cameraAssetPath?: string;
  cameraType?: string;
  translatedSrt?: string;
  dubbedAudioPath?: string;
  dubbedAudioType?: string;
  lipSyncCameraPath?: string;
  lipSyncCameraType?: string;
  lipSync?: DubbingLipSyncStatus;
  provider?: string;
  error?: string;
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
      status TEXT NOT NULL,
      audio_asset_path TEXT,
      audio_type TEXT,
      camera_asset_path TEXT,
      camera_type TEXT,
      translated_srt TEXT,
      dubbed_audio_path TEXT,
      dubbed_audio_type TEXT,
      lip_sync_camera_path TEXT,
      lip_sync_camera_type TEXT,
      lip_sync TEXT,
      provider TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  return sqlite;
}

type StoredRow = {
  id: string; user_id: string; recording_id: string; target_lang: 'en';
  source_audio_hash: string; source_srt: string | null; status: DubbingJobStatus;
  audio_asset_path: string | null; audio_type: string | null;
  camera_asset_path: string | null; camera_type: string | null;
  translated_srt: string | null; dubbed_audio_path: string | null; dubbed_audio_type: string | null;
  lip_sync_camera_path: string | null; lip_sync_camera_type: string | null;
  lip_sync: DubbingLipSyncStatus | null; provider: string | null; error: string | null;
  created_at: string | number; updated_at: string | number;
};

function fromRow(row: StoredRow | null | undefined): DubbingJob | undefined {
  if (!row) return undefined;
  const time = (value: string | number) => typeof value === 'number' ? value : new Date(value).getTime();
  return {
    id: row.id, userId: row.user_id, recordingId: row.recording_id, targetLang: row.target_lang,
    sourceAudioHash: row.source_audio_hash, sourceSrt: row.source_srt ?? undefined,
    status: row.status, createdAt: time(row.created_at), updatedAt: time(row.updated_at),
    audioAssetPath: row.audio_asset_path ?? undefined, audioType: row.audio_type ?? undefined,
    cameraAssetPath: row.camera_asset_path ?? undefined, cameraType: row.camera_type ?? undefined,
    translatedSrt: row.translated_srt ?? undefined,
    dubbedAudioPath: row.dubbed_audio_path ?? undefined, dubbedAudioType: row.dubbed_audio_type ?? undefined,
    lipSyncCameraPath: row.lip_sync_camera_path ?? undefined, lipSyncCameraType: row.lip_sync_camera_type ?? undefined,
    lipSync: row.lip_sync ?? undefined, provider: row.provider ?? undefined, error: row.error ?? undefined,
  };
}

function toRow(job: DubbingJob): StoredRow {
  return {
    id: job.id, user_id: job.userId, recording_id: job.recordingId, target_lang: job.targetLang,
    source_audio_hash: job.sourceAudioHash, source_srt: job.sourceSrt ?? null, status: job.status,
    audio_asset_path: job.audioAssetPath ?? null, audio_type: job.audioType ?? null,
    camera_asset_path: job.cameraAssetPath ?? null, camera_type: job.cameraType ?? null,
    translated_srt: job.translatedSrt ?? null,
    dubbed_audio_path: job.dubbedAudioPath ?? null, dubbed_audio_type: job.dubbedAudioType ?? null,
    lip_sync_camera_path: job.lipSyncCameraPath ?? null, lip_sync_camera_type: job.lipSyncCameraType ?? null,
    lip_sync: job.lipSync ?? null, provider: job.provider ?? null, error: job.error ?? null,
    created_at: job.createdAt, updated_at: job.updatedAt,
  };
}

export async function createDubbingJob(job: DubbingJob): Promise<void> {
  const row = toRow(job);
  if (useSupabase()) {
    const { error } = await supabaseAdmin().from('dubbing_jobs').insert({
      ...row,
      created_at: new Date(job.createdAt).toISOString(),
      updated_at: new Date(job.updatedAt).toISOString(),
    });
    if (error) throw new Error(`create_dubbing_job: ${error.message}`);
    return;
  }
  const keys = Object.keys(row);
  localDb().prepare(`INSERT INTO dubbing_jobs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((key) => row[key as keyof StoredRow]));
}

export async function getDubbingJob(id: string): Promise<DubbingJob | undefined> {
  if (useSupabase()) {
    const { data, error } = await supabaseAdmin().from('dubbing_jobs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`get_dubbing_job: ${error.message}`);
    return fromRow(data as StoredRow | null);
  }
  return fromRow(localDb().prepare('SELECT * FROM dubbing_jobs WHERE id = ?').get(id) as StoredRow | undefined);
}

export async function updateDubbingJob(id: string, patch: Partial<Omit<DubbingJob, 'id'>>): Promise<DubbingJob | undefined> {
  const current = await getDubbingJob(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id, updatedAt: Date.now() };
  const row = toRow(next);
  const mutable = Object.entries(row).filter(([key]) => key !== 'id');
  if (useSupabase()) {
    const body = Object.fromEntries(mutable);
    body.updated_at = new Date(next.updatedAt).toISOString();
    body.created_at = new Date(next.createdAt).toISOString();
    const { error } = await supabaseAdmin().from('dubbing_jobs').update(body).eq('id', id);
    if (error) throw new Error(`update_dubbing_job: ${error.message}`);
  } else {
    localDb().prepare(`UPDATE dubbing_jobs SET ${mutable.map(([key]) => `${key} = ?`).join(',')} WHERE id = ?`)
      .run(...mutable.map(([, value]) => value), id);
  }
  return next;
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
