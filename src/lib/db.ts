import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PaidRecordingRow } from '@/types/recording';
import type {
  SubscriptionStatus,
  SubscriptionTier,
  UserSubscription,
} from '@/types/user';

// ============================================================================
// Backend selection
// ----------------------------------------------------------------------------
// Pro 相关三张表（paid_recordings / user_subscriptions / subtitle_jobs）
// 当 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 都设置时，走 Supabase Postgres；
// 否则回退到本地 SQLite（开发模式）。
//
// users / auth_sessions 两张表只用于 legacy password login（实际未启用），
// 始终保留 SQLite 路径，避免引入更多迁移工作。
// ============================================================================

function isSupabase(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'excalicast' } },
  });
  return _sb;
}

let _backendLogged = false;
function logBackendOnce(): void {
  if (_backendLogged) return;
  _backendLogged = true;
  // eslint-disable-next-line no-console
  console.info(`[db] Pro tables backend = ${isSupabase() ? 'Supabase Postgres' : 'SQLite (local fallback)'}`);
}

// ============================================================================
// SQLite (legacy + Pro fallback)
// ============================================================================

const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
const DB_DIR = isServerless ? '/tmp' : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'excalicast.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS paid_recordings (
      recording_id TEXT PRIMARY KEY,
      paid_at INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      paddle_transaction_id TEXT NOT NULL,
      raw_payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      paddle_subscription_id TEXT,
      paddle_customer_id TEXT,
      current_period_end INTEGER,
      updated_at INTEGER NOT NULL,
      raw_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle ON user_subscriptions(paddle_subscription_id);

    CREATE TABLE IF NOT EXISTS subtitle_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      status TEXT NOT NULL,
      task_id TEXT,
      audio_token TEXT,
      srt TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_user ON subtitle_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_subtitle_jobs_recording ON subtitle_jobs(recording_id);
  `);

  const cols = db.prepare("PRAGMA table_info(paid_recordings)").all() as { name: string }[];
  const hasOld = cols.some((c) => c.name === 'creem_session_id');
  const hasNew = cols.some((c) => c.name === 'paddle_transaction_id');
  if (hasOld && !hasNew) {
    db.exec('ALTER TABLE paid_recordings RENAME COLUMN creem_session_id TO paddle_transaction_id');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_paid_recordings_paddle ON paid_recordings(paddle_transaction_id);');

  _db = db;
  return db;
}

// ============================================================================
// users / auth_sessions  (SQLite only — legacy password login)
// ============================================================================

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: number;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function insertUser(email: string, passwordHash: string): UserRow {
  const result = getDb()
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, passwordHash, Date.now());
  return getUserById(Number(result.lastInsertRowid))!;
}

export function createAuthSession(sessionId: string, userId: number, expiresAt: number): void {
  getDb()
    .prepare('INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, userId, Date.now(), expiresAt);
}

export function getAuthSession(sessionId: string): { user_id: number; expires_at: number } | undefined {
  return getDb()
    .prepare('SELECT user_id, expires_at FROM auth_sessions WHERE id = ?')
    .get(sessionId) as { user_id: number; expires_at: number } | undefined;
}

export function deleteAuthSession(sessionId: string): void {
  getDb().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
}

// ============================================================================
// paid_recordings  (Supabase | SQLite)
// ============================================================================

export async function isRecordingPaid(recordingId: string): Promise<boolean> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('paid_recordings')
      .select('recording_id')
      .eq('recording_id', recordingId)
      .maybeSingle();
    if (error) throw new Error(`isRecordingPaid: ${error.message}`);
    return !!data;
  }
  return getDb()
    .prepare('SELECT 1 FROM paid_recordings WHERE recording_id = ?')
    .get(recordingId) !== undefined;
}

export async function markRecordingPaid(params: {
  recordingId: string;
  amountCents: number;
  currency: string;
  paddleTransactionId: string;
  rawPayload: string;
}): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('paid_recordings')
      .upsert(
        {
          recording_id: params.recordingId,
          paid_at: new Date().toISOString(),
          amount_cents: params.amountCents,
          currency: params.currency,
          paddle_transaction_id: params.paddleTransactionId,
          raw_payload: params.rawPayload,
        },
        { onConflict: 'recording_id', ignoreDuplicates: true },
      );
    if (error) throw new Error(`markRecordingPaid: ${error.message}`);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO paid_recordings (recording_id, paid_at, amount_cents, currency, paddle_transaction_id, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recording_id) DO NOTHING`,
    )
    .run(
      params.recordingId,
      Date.now(),
      params.amountCents,
      params.currency,
      params.paddleTransactionId,
      params.rawPayload,
    );
}

export async function getPaidRecording(recordingId: string): Promise<PaidRecordingRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('paid_recordings')
      .select('*')
      .eq('recording_id', recordingId)
      .maybeSingle();
    if (error) throw new Error(`getPaidRecording: ${error.message}`);
    if (!data) return undefined;
    return {
      recording_id: data.recording_id,
      paid_at: new Date(data.paid_at as string).getTime(),
      amount_cents: data.amount_cents,
      currency: data.currency,
      paddle_transaction_id: data.paddle_transaction_id,
      raw_payload: data.raw_payload,
    };
  }
  return getDb()
    .prepare('SELECT * FROM paid_recordings WHERE recording_id = ?')
    .get(recordingId) as PaidRecordingRow | undefined;
}

// ============================================================================
// user_subscriptions  (Supabase | SQLite)
// ============================================================================

interface SqliteSubscriptionRow {
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  current_period_end: number | null;
  updated_at: number;
  raw_payload: string | null;
}

interface SupabaseSubscriptionRow {
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  current_period_end: string | null; // timestamptz ISO
  updated_at: string;
  raw_payload: string | null;
}

function rowToSubscriptionFromSqlite(row: SqliteSubscriptionRow | undefined): UserSubscription | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    tier: row.tier,
    status: row.status,
    paddleSubscriptionId: row.paddle_subscription_id,
    paddleCustomerId: row.paddle_customer_id,
    currentPeriodEnd: row.current_period_end,
    updatedAt: row.updated_at,
  };
}

function rowToSubscriptionFromSupabase(row: SupabaseSubscriptionRow | null): UserSubscription | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    tier: row.tier,
    status: row.status,
    paddleSubscriptionId: row.paddle_subscription_id,
    paddleCustomerId: row.paddle_customer_id,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`getUserSubscription: ${error.message}`);
    return rowToSubscriptionFromSupabase(data as SupabaseSubscriptionRow | null);
  }
  const row = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE user_id = ?')
    .get(userId) as SqliteSubscriptionRow | undefined;
  return rowToSubscriptionFromSqlite(row);
}

export async function findSubscriptionByPaddleId(paddleSubscriptionId: string): Promise<UserSubscription | null> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('user_subscriptions')
      .select('*')
      .eq('paddle_subscription_id', paddleSubscriptionId)
      .maybeSingle();
    if (error) throw new Error(`findSubscriptionByPaddleId: ${error.message}`);
    return rowToSubscriptionFromSupabase(data as SupabaseSubscriptionRow | null);
  }
  const row = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE paddle_subscription_id = ?')
    .get(paddleSubscriptionId) as SqliteSubscriptionRow | undefined;
  return rowToSubscriptionFromSqlite(row);
}

export async function upsertSubscription(params: {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  currentPeriodEnd: number | null;
  rawPayload: string | null;
}): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('user_subscriptions')
      .upsert(
        {
          user_id: params.userId,
          tier: params.tier,
          status: params.status,
          paddle_subscription_id: params.paddleSubscriptionId,
          paddle_customer_id: params.paddleCustomerId,
          current_period_end: params.currentPeriodEnd
            ? new Date(params.currentPeriodEnd).toISOString()
            : null,
          // updated_at is maintained by trigger touch_updated_at;
          // skip sending it to let the DB authoritative.
          raw_payload: params.rawPayload,
        },
        { onConflict: 'user_id' },
      );
    if (error) throw new Error(`upsertSubscription: ${error.message}`);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO user_subscriptions (user_id, tier, status, paddle_subscription_id, paddle_customer_id, current_period_end, updated_at, raw_payload)
       VALUES (@user_id, @tier, @status, @paddle_subscription_id, @paddle_customer_id, @current_period_end, @updated_at, @raw_payload)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = excluded.status,
         paddle_subscription_id = excluded.paddle_subscription_id,
         paddle_customer_id = excluded.paddle_customer_id,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at,
         raw_payload = excluded.raw_payload`,
    )
    .run({
      user_id: params.userId,
      tier: params.tier,
      status: params.status,
      paddle_subscription_id: params.paddleSubscriptionId,
      paddle_customer_id: params.paddleCustomerId,
      current_period_end: params.currentPeriodEnd,
      updated_at: Date.now(),
      raw_payload: params.rawPayload,
    });
}

// ============================================================================
// subtitle_jobs  (Supabase | SQLite)
// ============================================================================

export interface SubtitleJobRow {
  id: string;
  user_id: string;
  recording_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  task_id: string | null;
  audio_token: string | null;
  srt: string | null;
  error: string | null;
  created_at: number; // ms epoch (normalized at boundary)
  updated_at: number;
}

interface SupabaseSubtitleJobRaw {
  id: string;
  user_id: string;
  recording_id: string;
  status: SubtitleJobRow['status'];
  task_id: string | null;
  audio_token: string | null;
  srt: string | null;
  error: string | null;
  created_at: string; // ISO
  updated_at: string;
}

function jobFromSupabase(row: SupabaseSubtitleJobRaw | null): SubtitleJobRow | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    user_id: row.user_id,
    recording_id: row.recording_id,
    status: row.status,
    task_id: row.task_id,
    audio_token: row.audio_token,
    srt: row.srt,
    error: row.error,
    created_at: new Date(row.created_at).getTime(),
    updated_at: new Date(row.updated_at).getTime(),
  };
}

export async function createSubtitleJob(params: {
  id: string;
  userId: string;
  recordingId: string;
  audioToken: string;
}): Promise<SubtitleJobRow> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('subtitle_jobs')
      .insert({
        id: params.id,
        user_id: params.userId,
        recording_id: params.recordingId,
        status: 'pending',
        audio_token: params.audioToken,
      });
    if (error) throw new Error(`createSubtitleJob: ${error.message}`);
    const job = await getSubtitleJob(params.id);
    if (!job) throw new Error('createSubtitleJob: row not visible after insert');
    return job;
  }
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO subtitle_jobs (id, user_id, recording_id, status, audio_token, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(params.id, params.userId, params.recordingId, params.audioToken, now, now);
  const got = await getSubtitleJob(params.id);
  if (!got) throw new Error('createSubtitleJob: sqlite row not visible after insert');
  return got;
}

export async function getSubtitleJob(id: string): Promise<SubtitleJobRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('subtitle_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getSubtitleJob: ${error.message}`);
    return jobFromSupabase(data as SupabaseSubtitleJobRaw | null);
  }
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE id = ?')
    .get(id) as SubtitleJobRow | undefined;
}

export async function getSubtitleJobByAudioToken(audioToken: string): Promise<SubtitleJobRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('subtitle_jobs')
      .select('*')
      .eq('audio_token', audioToken)
      .maybeSingle();
    if (error) throw new Error(`getSubtitleJobByAudioToken: ${error.message}`);
    return jobFromSupabase(data as SupabaseSubtitleJobRaw | null);
  }
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE audio_token = ?')
    .get(audioToken) as SubtitleJobRow | undefined;
}

export async function updateSubtitleJob(
  id: string,
  patch: Partial<Pick<SubtitleJobRow, 'status' | 'task_id' | 'srt' | 'error'>>,
): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    // updated_at is touched by the SQL trigger, no need to send it.
    const { error } = await sb()
      .from('subtitle_jobs')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(`updateSubtitleJob: ${error.message}`);
    return;
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  getDb()
    .prepare(`UPDATE subtitle_jobs SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

// ============================================================================
// recordings_cloud  (Supabase only — Pro cloud backup of recording sources)
// ----------------------------------------------------------------------------
// **Constraint**: never stores rendered MP4. Bytes live in storage bucket
// `recordings` as metadata.json + snapshots.json.gz + audio.webm + camera.webm.
// ============================================================================

export interface RecordingCloudRow {
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

interface SupabaseRecordingCloudRow {
  id: string;
  user_id: string;
  title: string | null;
  started_at: string;
  duration_ms: number;
  has_audio: boolean;
  has_camera: boolean;
  subtitle_srt: string | null;
  thumbnail: string | null;
  storage_prefix: string;
  bytes_stored: number | null;
  uploaded_at: string;
  updated_at: string;
}

function rowToRecordingCloud(r: SupabaseRecordingCloudRow): RecordingCloudRow {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    startedAt: new Date(r.started_at).getTime(),
    durationMs: r.duration_ms,
    hasAudio: r.has_audio,
    hasCamera: r.has_camera,
    subtitleSrt: r.subtitle_srt,
    thumbnail: r.thumbnail,
    storagePrefix: r.storage_prefix,
    bytesStored: r.bytes_stored,
    uploadedAt: new Date(r.uploaded_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

function requireSupabase(): SupabaseClient {
  if (!isSupabase()) {
    throw new Error('cloud_backup_requires_supabase');
  }
  return sb();
}

export async function listCloudRecordings(userId: string): Promise<RecordingCloudRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('recordings_cloud')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  if (error) throw new Error(`listCloudRecordings: ${error.message}`);
  return (data as SupabaseRecordingCloudRow[]).map(rowToRecordingCloud);
}

export async function getCloudRecording(
  userId: string,
  id: string,
): Promise<RecordingCloudRow | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('recordings_cloud')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCloudRecording: ${error.message}`);
  return data ? rowToRecordingCloud(data as SupabaseRecordingCloudRow) : null;
}

export async function upsertCloudRecording(params: {
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
}): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('recordings_cloud')
    .upsert({
      id: params.id,
      user_id: params.userId,
      title: params.title,
      started_at: new Date(params.startedAt).toISOString(),
      duration_ms: params.durationMs,
      has_audio: params.hasAudio,
      has_camera: params.hasCamera,
      subtitle_srt: params.subtitleSrt,
      thumbnail: params.thumbnail,
      storage_prefix: params.storagePrefix,
      bytes_stored: params.bytesStored,
      uploaded_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  if (error) throw new Error(`upsertCloudRecording: ${error.message}`);
}

export async function deleteCloudRecording(userId: string, id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('recordings_cloud')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`deleteCloudRecording: ${error.message}`);
}

/**
 * Remove all 4 object files belonging to a recording's storage prefix.
 * Service-role bypasses RLS, which is required when a route runs server-side.
 */
export async function removeCloudRecordingObjects(storagePrefix: string): Promise<void> {
  const client = requireSupabase();
  const names = ['metadata.json', 'snapshots.json.gz', 'audio.webm', 'camera.webm']
    .map((n) => `${storagePrefix.replace(/\/$/, '')}/${n}`);
  const { error } = await client.storage.from('recordings').remove(names);
  if (error) throw new Error(`removeCloudRecordingObjects: ${error.message}`);
}
