import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { PaidRecordingRow } from '@/types/recording';

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
