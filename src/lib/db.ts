import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { PaidRecordingRow } from '@/types/recording';
import type {
  SubscriptionStatus,
  SubscriptionTier,
  UserSubscription,
} from '@/types/user';

// Vercel 的应用文件系统只读，写入必须落到 /tmp（每个实例独立、冷启动丢失）。
// 本地开发仍写到项目内 data/ 目录方便排查。
// 生产环境若要持久化付费记录，请把这里换成 Vercel Postgres / KV / Turso。
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

    -- Pro/Max 订阅状态：以 NextAuth user.id（即 token.sub，TEXT）为主键
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

    -- ASR 任务（千问 DashScope）异步状态
    CREATE TABLE IF NOT EXISTS subtitle_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      status TEXT NOT NULL,                -- pending | running | done | failed
      task_id TEXT,                        -- DashScope task_id
      audio_token TEXT,                    -- 临时签名 token（暴露音频给 DashScope）
      srt TEXT,                            -- 完成后的 SRT 文本
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

export function isRecordingPaid(recordingId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM paid_recordings WHERE recording_id = ?')
    .get(recordingId);
  return row !== undefined;
}

export function markRecordingPaid(params: {
  recordingId: string;
  amountCents: number;
  currency: string;
  paddleTransactionId: string;
  rawPayload: string;
}): void {
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

export function getPaidRecording(recordingId: string): PaidRecordingRow | undefined {
  return getDb()
    .prepare('SELECT * FROM paid_recordings WHERE recording_id = ?')
    .get(recordingId) as PaidRecordingRow | undefined;
}

// ========== Pro 会员订阅 ==========

interface SubscriptionRow {
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  current_period_end: number | null;
  updated_at: number;
  raw_payload: string | null;
}

function rowToSubscription(row: SubscriptionRow | undefined): UserSubscription | null {
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

export function getUserSubscription(userId: string): UserSubscription | null {
  const row = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE user_id = ?')
    .get(userId) as SubscriptionRow | undefined;
  return rowToSubscription(row);
}

export function findSubscriptionByPaddleId(paddleSubscriptionId: string): UserSubscription | null {
  const row = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE paddle_subscription_id = ?')
    .get(paddleSubscriptionId) as SubscriptionRow | undefined;
  return rowToSubscription(row);
}

export function upsertSubscription(params: {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  currentPeriodEnd: number | null;
  rawPayload: string | null;
}): void {
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

// ========== ASR / 字幕任务 ==========

export interface SubtitleJobRow {
  id: string;
  user_id: string;
  recording_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  task_id: string | null;
  audio_token: string | null;
  srt: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export function createSubtitleJob(params: {
  id: string;
  userId: string;
  recordingId: string;
  audioToken: string;
}): SubtitleJobRow {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO subtitle_jobs (id, user_id, recording_id, status, audio_token, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(params.id, params.userId, params.recordingId, params.audioToken, now, now);
  return getSubtitleJob(params.id)!;
}

export function getSubtitleJob(id: string): SubtitleJobRow | undefined {
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE id = ?')
    .get(id) as SubtitleJobRow | undefined;
}

export function getSubtitleJobByAudioToken(audioToken: string): SubtitleJobRow | undefined {
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE audio_token = ?')
    .get(audioToken) as SubtitleJobRow | undefined;
}

export function updateSubtitleJob(
  id: string,
  patch: Partial<Pick<SubtitleJobRow, 'status' | 'task_id' | 'srt' | 'error'>>,
): void {
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
