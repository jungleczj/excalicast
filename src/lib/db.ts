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
import type { PaymentMode, PaymentProvider } from '@/lib/paymentConfig';
import {
  resolveHighestEntitlement,
  shouldApplySubscriptionEvent,
} from '@/lib/paymentDomain';
import crypto from 'node:crypto';

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
const DB_PATH = process.env.EXCALICAST_DB_PATH
  ?? path.join(isServerless ? '/tmp' : path.join(process.cwd(), 'data'), 'excalicast.db');
const DB_DIR = path.dirname(DB_PATH);

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
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'paddle' CHECK (provider IN ('creem','paddle')),
      provider_subscription_id TEXT,
      provider_customer_id TEXT,
      paddle_subscription_id TEXT,
      paddle_customer_id TEXT,
      current_period_end INTEGER,
      last_event_occurred_at INTEGER,
      updated_at INTEGER NOT NULL,
      raw_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle ON user_subscriptions(paddle_subscription_id);

    CREATE TABLE IF NOT EXISTS checkout_attempts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
      mode TEXT NOT NULL CHECK (mode IN ('live','test')),
      kind TEXT NOT NULL CHECK (kind IN ('one_time','subscription')),
      tier TEXT,
      billing TEXT,
      recording_id TEXT,
      user_id TEXT,
      product_id TEXT NOT NULL,
      provider_transaction_id TEXT,
      status TEXT NOT NULL,
      raw_request TEXT,
      raw_response TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_checkout_attempts_provider_tx
      ON checkout_attempts(provider, provider_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_checkout_attempts_user ON checkout_attempts(user_id);
    CREATE INDEX IF NOT EXISTS idx_checkout_attempts_recording ON checkout_attempts(recording_id);

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at INTEGER,
      processed_at INTEGER NOT NULL,
      ignored_reason TEXT,
      raw_payload TEXT NOT NULL,
      UNIQUE(provider, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_type
      ON payment_webhook_events(provider, event_type);

    CREATE TABLE IF NOT EXISTS subtitle_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recording_id TEXT NOT NULL,
      status TEXT NOT NULL,
      task_id TEXT,
      audio_token TEXT,
      asset_path TEXT,
      asset_bytes INTEGER,
      mime_type TEXT,
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
  const subtitleCols = db.prepare("PRAGMA table_info(subtitle_jobs)").all() as { name: string }[];
  if (!subtitleCols.some((c) => c.name === 'asset_path')) db.exec('ALTER TABLE subtitle_jobs ADD COLUMN asset_path TEXT');
  if (!subtitleCols.some((c) => c.name === 'asset_bytes')) db.exec('ALTER TABLE subtitle_jobs ADD COLUMN asset_bytes INTEGER');
  if (!subtitleCols.some((c) => c.name === 'mime_type')) db.exec('ALTER TABLE subtitle_jobs ADD COLUMN mime_type TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_paid_recordings_paddle ON paid_recordings(paddle_transaction_id);');
  migrateSqliteSubscriptions(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_provider_sub
      ON user_subscriptions(provider, provider_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle ON user_subscriptions(paddle_subscription_id);
  `);

  _db = db;
  return db;
}

function migrateSqliteSubscriptions(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(user_subscriptions)").all() as { name: string }[];
  const hasId = cols.some((c) => c.name === 'id');
  const hasProvider = cols.some((c) => c.name === 'provider');
  if (hasId && hasProvider) return;

  const migrate = db.transaction(() => {
    db.exec('ALTER TABLE user_subscriptions RENAME TO user_subscriptions_legacy');
    db.exec(`
      CREATE TABLE user_subscriptions (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'inactive',
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'paddle' CHECK (provider IN ('creem','paddle')),
        provider_subscription_id TEXT,
        provider_customer_id TEXT,
        paddle_subscription_id TEXT,
        paddle_customer_id TEXT,
        current_period_end INTEGER,
        last_event_occurred_at INTEGER,
        updated_at INTEGER NOT NULL,
        raw_payload TEXT
      );
    `);
    const legacyRows = db.prepare('SELECT * FROM user_subscriptions_legacy').all() as Array<{
      user_id: string;
      tier: SubscriptionTier;
      status: SubscriptionStatus;
      paddle_subscription_id: string | null;
      paddle_customer_id: string | null;
      current_period_end: number | null;
      updated_at: number;
      raw_payload: string | null;
    }>;
    const insert = db.prepare(`
      INSERT INTO user_subscriptions
        (id, user_id, provider, tier, status, provider_subscription_id, provider_customer_id,
         paddle_subscription_id, paddle_customer_id, current_period_end, last_event_occurred_at, updated_at, raw_payload)
      VALUES
        (@id, @user_id, 'paddle', @tier, @status, @paddle_subscription_id, @paddle_customer_id,
         @paddle_subscription_id, @paddle_customer_id, @current_period_end, @updated_at, @updated_at, @raw_payload)
    `);
    for (const row of legacyRows) {
      insert.run({ ...row, id: crypto.randomUUID() });
    }
    db.exec('DROP TABLE user_subscriptions_legacy');
  });
  migrate();
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
  id: string;
  user_id: string;
  provider: PaymentProvider;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  current_period_end: number | null;
  last_event_occurred_at: number | null;
  updated_at: number;
  raw_payload: string | null;
}

interface SupabaseSubscriptionRow {
  id?: string;
  user_id: string;
  provider?: PaymentProvider;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  current_period_end: string | null; // timestamptz ISO
  last_event_occurred_at?: string | null;
  updated_at: string;
  raw_payload: string | null;
}

function rowToSubscriptionFromSqlite(row: SqliteSubscriptionRow | undefined): UserSubscription | null {
  if (!row) return null;
  const provider = row.provider ?? 'paddle';
  return {
    userId: row.user_id,
    provider,
    tier: row.tier,
    status: row.status,
    providerSubscriptionId: row.provider_subscription_id ?? row.paddle_subscription_id,
    providerCustomerId: row.provider_customer_id ?? row.paddle_customer_id,
    paddleSubscriptionId: row.paddle_subscription_id,
    paddleCustomerId: row.paddle_customer_id,
    currentPeriodEnd: row.current_period_end,
    lastEventOccurredAt: row.last_event_occurred_at,
    updatedAt: row.updated_at,
  };
}

function rowToSubscriptionFromSupabase(row: SupabaseSubscriptionRow | null): UserSubscription | null {
  if (!row) return null;
  const provider = row.provider ?? 'paddle';
  return {
    userId: row.user_id,
    provider,
    tier: row.tier,
    status: row.status,
    providerSubscriptionId: row.provider_subscription_id ?? row.paddle_subscription_id,
    providerCustomerId: row.provider_customer_id ?? row.paddle_customer_id,
    paddleSubscriptionId: row.paddle_subscription_id,
    paddleCustomerId: row.paddle_customer_id,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
    lastEventOccurredAt: row.last_event_occurred_at ? new Date(row.last_event_occurred_at).getTime() : null,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId);
    if (error) throw new Error(`getUserSubscription: ${error.message}`);
    const rows = (data as SupabaseSubscriptionRow[]).map(rowToSubscriptionFromSupabase).filter(Boolean) as UserSubscription[];
    return pickHighestStoredSubscription(rows);
  }
  const rows = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE user_id = ?')
    .all(userId) as SqliteSubscriptionRow[];
  return pickHighestStoredSubscription(rows.map(rowToSubscriptionFromSqlite).filter(Boolean) as UserSubscription[]);
}

export async function findSubscriptionByPaddleId(paddleSubscriptionId: string): Promise<UserSubscription | null> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('user_subscriptions')
      .select('*')
      .or(`paddle_subscription_id.eq.${paddleSubscriptionId},provider_subscription_id.eq.${paddleSubscriptionId}`)
      .maybeSingle();
    if (error) throw new Error(`findSubscriptionByPaddleId: ${error.message}`);
    return rowToSubscriptionFromSupabase(data as SupabaseSubscriptionRow | null);
  }
  const row = getDb()
    .prepare('SELECT * FROM user_subscriptions WHERE paddle_subscription_id = ? OR provider_subscription_id = ?')
    .get(paddleSubscriptionId, paddleSubscriptionId) as SqliteSubscriptionRow | undefined;
  return rowToSubscriptionFromSqlite(row);
}

function pickHighestStoredSubscription(rows: UserSubscription[]): UserSubscription | null {
  const entitledRows = rows.filter((row): row is UserSubscription & { tier: Exclude<SubscriptionTier, 'free'> } => row.tier !== 'free');
  const best = resolveHighestEntitlement(entitledRows.map((row) => ({
    provider: row.provider,
    tier: row.tier,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
  })));
  if (!best) {
    return [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }
  return rows.find((row) => row.provider === best.provider && row.tier === best.tier && row.status === best.status)
    ?? [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    ?? null;
}

export async function upsertProviderSubscription(params: {
  userId: string;
  provider: PaymentProvider;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  currentPeriodEnd: number | null;
  eventOccurredAt: number | null;
  rawPayload: string | null;
}): Promise<{ applied: boolean }> {
  logBackendOnce();
  if (isSupabase()) {
    let existing: SupabaseSubscriptionRow | null = null;
    if (params.providerSubscriptionId) {
      const { data, error } = await sb()
        .from('user_subscriptions')
        .select('*')
        .eq('provider', params.provider)
        .eq('provider_subscription_id', params.providerSubscriptionId)
        .maybeSingle();
      if (error) throw new Error(`upsertProviderSubscription (read): ${error.message}`);
      existing = data as SupabaseSubscriptionRow | null;
    }
    const previousOccurredAt = existing?.last_event_occurred_at
      ? Date.parse(existing.last_event_occurred_at)
      : null;
    if (!shouldApplySubscriptionEvent(params.eventOccurredAt, previousOccurredAt)) {
      return { applied: false };
    }
    const now = new Date().toISOString();
    const row = {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: params.userId,
      provider: params.provider,
      tier: params.tier,
      status: params.status,
      provider_subscription_id: params.providerSubscriptionId,
      provider_customer_id: params.providerCustomerId,
      paddle_subscription_id: params.provider === 'paddle' ? params.providerSubscriptionId : null,
      paddle_customer_id: params.provider === 'paddle' ? params.providerCustomerId : null,
      current_period_end: params.currentPeriodEnd ? new Date(params.currentPeriodEnd).toISOString() : null,
      last_event_occurred_at: params.eventOccurredAt ? new Date(params.eventOccurredAt).toISOString() : null,
      updated_at: now,
      raw_payload: params.rawPayload,
    };
    const { error } = await sb()
      .from('user_subscriptions')
      .upsert(row, { onConflict: 'provider,provider_subscription_id' });
    if (error) throw new Error(`upsertProviderSubscription: ${error.message}`);
    return { applied: true };
  }

  const db = getDb();
  const tx = db.transaction(() => {
    const existing = params.providerSubscriptionId
      ? db.prepare('SELECT * FROM user_subscriptions WHERE provider = ? AND provider_subscription_id = ?')
        .get(params.provider, params.providerSubscriptionId) as SqliteSubscriptionRow | undefined
      : undefined;
    if (!shouldApplySubscriptionEvent(params.eventOccurredAt, existing?.last_event_occurred_at ?? null)) {
      return false;
    }
    db.prepare(
      `INSERT INTO user_subscriptions
         (id, user_id, provider, tier, status, provider_subscription_id, provider_customer_id,
          paddle_subscription_id, paddle_customer_id, current_period_end, last_event_occurred_at, updated_at, raw_payload)
       VALUES
         (@id, @user_id, @provider, @tier, @status, @provider_subscription_id, @provider_customer_id,
          @paddle_subscription_id, @paddle_customer_id, @current_period_end, @last_event_occurred_at, @updated_at, @raw_payload)
       ON CONFLICT(provider, provider_subscription_id) DO UPDATE SET
         user_id = excluded.user_id,
         tier = excluded.tier,
         status = excluded.status,
         provider_customer_id = excluded.provider_customer_id,
         paddle_subscription_id = excluded.paddle_subscription_id,
         paddle_customer_id = excluded.paddle_customer_id,
         current_period_end = excluded.current_period_end,
         last_event_occurred_at = excluded.last_event_occurred_at,
         updated_at = excluded.updated_at,
         raw_payload = excluded.raw_payload`,
    ).run({
      id: existing?.id ?? crypto.randomUUID(),
      user_id: params.userId,
      provider: params.provider,
      tier: params.tier,
      status: params.status,
      provider_subscription_id: params.providerSubscriptionId,
      provider_customer_id: params.providerCustomerId,
      paddle_subscription_id: params.provider === 'paddle' ? params.providerSubscriptionId : null,
      paddle_customer_id: params.provider === 'paddle' ? params.providerCustomerId : null,
      current_period_end: params.currentPeriodEnd,
      last_event_occurred_at: params.eventOccurredAt,
      updated_at: Date.now(),
      raw_payload: params.rawPayload,
    });
    return true;
  });
  return { applied: tx() };
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
  await upsertProviderSubscription({
    userId: params.userId,
    provider: 'paddle',
    tier: params.tier,
    status: params.status,
    providerSubscriptionId: params.paddleSubscriptionId,
    providerCustomerId: params.paddleCustomerId,
    currentPeriodEnd: params.currentPeriodEnd,
    eventOccurredAt: Date.now(),
    rawPayload: params.rawPayload,
  });
}

// ============================================================================
// checkout_attempts + payment_webhook_events  (Supabase | SQLite)
// ============================================================================

export interface CheckoutAttemptRow {
  id: string;
  provider: PaymentProvider;
  mode: PaymentMode;
  kind: 'one_time' | 'subscription';
  tier: SubscriptionTier | null;
  billing: 'monthly' | 'yearly' | null;
  recording_id: string | null;
  user_id: string | null;
  product_id: string;
  provider_transaction_id: string | null;
  status: 'pending' | 'created' | 'failed';
  raw_request: string | null;
  raw_response: string | null;
  created_at: number;
  updated_at: number;
}

export async function insertCheckoutAttempt(params: {
  provider: PaymentProvider;
  mode: PaymentMode;
  kind: 'one_time' | 'subscription';
  tier: SubscriptionTier | null;
  billing: 'monthly' | 'yearly' | null;
  recordingId: string | null;
  userId: string | null;
  productId: string;
  rawRequest: string | null;
}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb().from('checkout_attempts').insert({
      id,
      provider: params.provider,
      mode: params.mode,
      kind: params.kind,
      tier: params.tier,
      billing: params.billing,
      recording_id: params.recordingId,
      user_id: params.userId,
      product_id: params.productId,
      status: 'pending',
      raw_request: params.rawRequest,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    if (error) throw new Error(`insertCheckoutAttempt: ${error.message}`);
    return { id };
  }
  getDb().prepare(
    `INSERT INTO checkout_attempts
       (id, provider, mode, kind, tier, billing, recording_id, user_id, product_id,
        status, raw_request, created_at, updated_at)
     VALUES
       (@id, @provider, @mode, @kind, @tier, @billing, @recording_id, @user_id, @product_id,
        'pending', @raw_request, @created_at, @updated_at)`,
  ).run({
    id,
    provider: params.provider,
    mode: params.mode,
    kind: params.kind,
    tier: params.tier,
    billing: params.billing,
    recording_id: params.recordingId,
    user_id: params.userId,
    product_id: params.productId,
    raw_request: params.rawRequest,
    created_at: now,
    updated_at: now,
  });
  return { id };
}

export async function completeCheckoutAttempt(params: {
  id: string;
  providerTransactionId: string | null;
  rawResponse: string | null;
}): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('checkout_attempts')
      .update({
        provider_transaction_id: params.providerTransactionId,
        status: 'created',
        raw_response: params.rawResponse,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);
    if (error) throw new Error(`completeCheckoutAttempt: ${error.message}`);
    return;
  }
  getDb().prepare(
    `UPDATE checkout_attempts
     SET provider_transaction_id = ?, status = 'created', raw_response = ?, updated_at = ?
     WHERE id = ?`,
  ).run(params.providerTransactionId, params.rawResponse, Date.now(), params.id);
}

export async function failCheckoutAttempt(params: {
  id: string;
  rawResponse: string | null;
}): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('checkout_attempts')
      .update({ status: 'failed', raw_response: params.rawResponse, updated_at: new Date().toISOString() })
      .eq('id', params.id);
    if (error) throw new Error(`failCheckoutAttempt: ${error.message}`);
    return;
  }
  getDb().prepare(
    `UPDATE checkout_attempts SET status = 'failed', raw_response = ?, updated_at = ? WHERE id = ?`,
  ).run(params.rawResponse, Date.now(), params.id);
}

export async function getCheckoutAttempt(id: string): Promise<CheckoutAttemptRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('checkout_attempts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getCheckoutAttempt: ${error.message}`);
    if (!data) return undefined;
    const row = data as Omit<CheckoutAttemptRow, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string };
    return {
      ...row,
      created_at: new Date(row.created_at).getTime(),
      updated_at: new Date(row.updated_at).getTime(),
    };
  }
  return getDb().prepare('SELECT * FROM checkout_attempts WHERE id = ?').get(id) as CheckoutAttemptRow | undefined;
}

export async function recordPaymentWebhookEvent(params: {
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  occurredAt: number | null;
  rawPayload: string;
}): Promise<{ duplicate: boolean }> {
  logBackendOnce();
  const id = crypto.randomUUID();
  const now = Date.now();
  if (isSupabase()) {
    const { error } = await sb().from('payment_webhook_events').insert({
      id,
      provider: params.provider,
      event_id: params.eventId,
      event_type: params.eventType,
      occurred_at: params.occurredAt ? new Date(params.occurredAt).toISOString() : null,
      processed_at: new Date(now).toISOString(),
      raw_payload: params.rawPayload,
    });
    if (error) {
      if (error.code === '23505') return { duplicate: true };
      throw new Error(`recordPaymentWebhookEvent: ${error.message}`);
    }
    return { duplicate: false };
  }
  try {
    getDb().prepare(
      `INSERT INTO payment_webhook_events
         (id, provider, event_id, event_type, occurred_at, processed_at, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, params.provider, params.eventId, params.eventType, params.occurredAt, now, params.rawPayload);
    return { duplicate: false };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { duplicate: true };
    }
    throw err;
  }
}

export async function isPaymentWebhookEventRecorded(
  provider: PaymentProvider,
  eventId: string,
): Promise<boolean> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('payment_webhook_events')
      .select('id')
      .eq('provider', provider)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(`isPaymentWebhookEventRecorded: ${error.message}`);
    return !!data;
  }
  return getDb()
    .prepare('SELECT 1 FROM payment_webhook_events WHERE provider = ? AND event_id = ?')
    .get(provider, eventId) !== undefined;
}

export async function releasePaymentWebhookEvent(
  provider: PaymentProvider,
  eventId: string,
): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    const { error } = await sb()
      .from('payment_webhook_events')
      .delete()
      .eq('provider', provider)
      .eq('event_id', eventId);
    if (error) throw new Error(`releasePaymentWebhookEvent: ${error.message}`);
    return;
  }
  getDb()
    .prepare('DELETE FROM payment_webhook_events WHERE provider = ? AND event_id = ?')
    .run(provider, eventId);
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
  asset_path: string | null;
  asset_bytes: number | null;
  mime_type: string | null;
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
  asset_path: string | null;
  asset_bytes: number | null;
  mime_type: string | null;
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
    asset_path: row.asset_path,
    asset_bytes: row.asset_bytes,
    mime_type: row.mime_type,
    srt: row.srt,
    error: row.error,
    created_at: new Date(row.created_at).getTime(),
    updated_at: new Date(row.updated_at).getTime(),
  };
}

function subtitleJobError(prefix: string, error: { code?: string; message: string }): Error {
  return Object.assign(new Error(`${prefix}: ${error.message}`), { code: error.code });
}

export async function createSubtitleJob(params: {
  id: string;
  userId: string;
  recordingId: string;
  audioToken?: string;
  assetPath?: string;
  assetBytes?: number;
  mimeType?: string;
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
        audio_token: params.audioToken ?? null,
        asset_path: params.assetPath ?? null,
        asset_bytes: params.assetBytes ?? null,
        mime_type: params.mimeType ?? null,
      });
    if (error) throw subtitleJobError('createSubtitleJob', error);
    const job = await getSubtitleJob(params.id, params.userId);
    if (!job) throw new Error('createSubtitleJob: row not visible after insert');
    return job;
  }
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO subtitle_jobs (id, user_id, recording_id, status, audio_token, asset_path, asset_bytes, mime_type, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(params.id, params.userId, params.recordingId, params.audioToken ?? null, params.assetPath ?? null, params.assetBytes ?? null, params.mimeType ?? null, now, now);
  const got = await getSubtitleJob(params.id, params.userId);
  if (!got) throw new Error('createSubtitleJob: sqlite row not visible after insert');
  return got;
}

export async function getSubtitleJob(id: string, userId: string): Promise<SubtitleJobRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('subtitle_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw subtitleJobError('getSubtitleJob', error);
    return jobFromSupabase(data as SupabaseSubtitleJobRaw | null);
  }
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE id = ? AND user_id = ?')
    .get(id, userId) as SubtitleJobRow | undefined;
}

export async function getSubtitleJobByAudioToken(audioToken: string): Promise<SubtitleJobRow | undefined> {
  logBackendOnce();
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('subtitle_jobs')
      .select('*')
      .eq('audio_token', audioToken)
      .maybeSingle();
    if (error) throw subtitleJobError('getSubtitleJobByAudioToken', error);
    return jobFromSupabase(data as SupabaseSubtitleJobRaw | null);
  }
  return getDb()
    .prepare('SELECT * FROM subtitle_jobs WHERE audio_token = ?')
    .get(audioToken) as SubtitleJobRow | undefined;
}

export async function updateSubtitleJob(
  id: string,
  userId: string,
  patch: Partial<Pick<SubtitleJobRow, 'status' | 'task_id' | 'srt' | 'error'>>,
): Promise<void> {
  logBackendOnce();
  if (isSupabase()) {
    // updated_at is touched by the SQL trigger, no need to send it.
    const { error } = await sb()
      .from('subtitle_jobs')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw subtitleJobError('updateSubtitleJob', error);
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
    .prepare(`UPDATE subtitle_jobs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...values, userId);
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

export async function updateCloudRecordingTitle(
  userId: string,
  id: string,
  title: string | null,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('recordings_cloud')
    .update({ title })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`updateCloudRecordingTitle: ${error.message}`);
}

export async function updateCloudRecordingSubtitle(
  userId: string,
  id: string,
  subtitleSrt: string | null,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('recordings_cloud')
    .update({ subtitle_srt: subtitleSrt })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`updateCloudRecordingSubtitle: ${error.message}`);
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
  const names = ['metadata.json', 'snapshots.json.gz', 'audio.webm', 'camera.webm', 'cameraPositions.json.gz']
    .map((n) => `${storagePrefix.replace(/\/$/, '')}/${n}`);
  const { error } = await client.storage.from('recordings').remove(names);
  if (error) throw new Error(`removeCloudRecordingObjects: ${error.message}`);
}

// ============================================================================
// library_items_cloud —— pro/max 模板库跨设备同步（小 JSON，直接存 jsonb）
// ============================================================================

export interface LibraryItemCloudRow {
  id: string;
  status: 'published' | 'unpublished';
  elements: unknown[];
  name?: string;
  created: number;
}

// 返回活跃项 + 已删除（坠牌）id 列表 —— 让其它设备拉取时能得知删除并本地同步移除。
export async function listUserLibrary(
  userId: string,
): Promise<{ items: LibraryItemCloudRow[]; deletedIds: string[] }> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('library_items_cloud')
    .select('id, status, elements, name, created, deleted')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`listUserLibrary: ${error.message}`);
  const items: LibraryItemCloudRow[] = [];
  const deletedIds: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of data as any[]) {
    if (r.deleted) {
      deletedIds.push(String(r.id));
      continue;
    }
    items.push({
      id: String(r.id),
      status: r.status === 'published' ? 'published' : 'unpublished',
      elements: Array.isArray(r.elements) ? r.elements : [],
      name: typeof r.name === 'string' ? r.name : undefined,
      created: typeof r.created === 'number' ? r.created : Number(r.created) || Date.now(),
    });
  }
  return { items, deletedIds };
}

export async function upsertUserLibrary(userId: string, items: LibraryItemCloudRow[]): Promise<void> {
  if (items.length === 0) return;
  const client = requireSupabase();
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    user_id: userId,
    id: String(it.id),
    status: it.status === 'published' ? 'published' : 'unpublished',
    elements: Array.isArray(it.elements) ? it.elements : [],
    name: it.name ?? null,
    created: it.created ?? Date.now(),
    deleted: false, // (重新)新增/导入 ＝ 取消删除
    updated_at: now,
  }));
  const { error } = await client
    .from('library_items_cloud')
    .upsert(rows, { onConflict: 'user_id,id' });
  if (error) throw new Error(`upsertUserLibrary: ${error.message}`);
}

// 软删除：保留行作云端坠牌（deleted=true），其它设备拉取时据此移除本地副本。
export async function deleteUserLibraryItem(userId: string, id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('library_items_cloud')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(`deleteUserLibraryItem: ${error.message}`);
}

// ============================================================================
// share_links —— Max tier 公开分享链接
// ============================================================================

export interface ShareLinkRow {
  id: string;
  shortCode: string;
  recordingId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
}

interface SupabaseShareLinkRow {
  id: string;
  short_code: string;
  recording_id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  access_count: number;
}

function rowToShareLink(r: SupabaseShareLinkRow): ShareLinkRow {
  return {
    id: r.id,
    shortCode: r.short_code,
    recordingId: r.recording_id,
    userId: r.user_id,
    createdAt: new Date(r.created_at).getTime(),
    expiresAt: new Date(r.expires_at).getTime(),
    accessCount: r.access_count,
  };
}

export async function insertShareLink(params: {
  shortCode: string;
  recordingId: string;
  userId: string;
  expiresAt: number;
}): Promise<ShareLinkRow> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('share_links')
    .insert({
      short_code: params.shortCode,
      recording_id: params.recordingId,
      user_id: params.userId,
      expires_at: new Date(params.expiresAt).toISOString(),
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertShareLink: ${error.message}`);
  return rowToShareLink(data as SupabaseShareLinkRow);
}

export async function getShareLinkByCode(shortCode: string): Promise<ShareLinkRow | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('share_links')
    .select('*')
    .eq('short_code', shortCode)
    .maybeSingle();
  if (error) throw new Error(`getShareLinkByCode: ${error.message}`);
  return data ? rowToShareLink(data as SupabaseShareLinkRow) : null;
}

export async function bumpShareLinkAccessCount(id: string): Promise<void> {
  const client = requireSupabase();
  // 用 rpc 也行；这里 service role 下用两步：读 + 写
  const { data, error } = await client
    .from('share_links')
    .select('access_count')
    .eq('id', id)
    .maybeSingle();
  if (error) return; // 静默：访问计数失败不阻塞响应
  const cur = (data as { access_count: number } | null)?.access_count ?? 0;
  await client.from('share_links').update({ access_count: cur + 1 }).eq('id', id);
}

export async function expireShareLink(id: string, userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('share_links')
    .update({ expires_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(`expireShareLink: ${error.message}`);
}

// ============================================================================
// handouts —— Max tier 讲义 / outline
// ============================================================================

export interface HandoutRow {
  id: string;
  recordingId: string;
  userId: string;
  outline: unknown;   // jsonb，由 routes 自己 cast
  markdown: string;
  model: string;
  generatedAt: number;
}

interface SupabaseHandoutRow {
  id: string;
  recording_id: string;
  user_id: string;
  outline: unknown;
  markdown: string;
  model: string;
  generated_at: string;
}

function rowToHandout(r: SupabaseHandoutRow): HandoutRow {
  return {
    id: r.id,
    recordingId: r.recording_id,
    userId: r.user_id,
    outline: r.outline,
    markdown: r.markdown,
    model: r.model,
    generatedAt: new Date(r.generated_at).getTime(),
  };
}

export async function upsertHandout(params: {
  recordingId: string;
  userId: string;
  outline: unknown;
  markdown: string;
  model: string;
}): Promise<HandoutRow> {
  const client = requireSupabase();
  // recording_id 上有 UNIQUE 索引；用 upsert(onConflict: 'recording_id')
  const { data, error } = await client
    .from('handouts')
    .upsert(
      {
        recording_id: params.recordingId,
        user_id: params.userId,
        outline: params.outline,
        markdown: params.markdown,
        model: params.model,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'recording_id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(`upsertHandout: ${error.message}`);
  return rowToHandout(data as SupabaseHandoutRow);
}

export async function getHandoutByRecording(
  userId: string,
  recordingId: string,
): Promise<HandoutRow | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('handouts')
    .select('*')
    .eq('user_id', userId)
    .eq('recording_id', recordingId)
    .maybeSingle();
  if (error) throw new Error(`getHandoutByRecording: ${error.message}`);
  return data ? rowToHandout(data as SupabaseHandoutRow) : null;
}

export async function deleteHandout(userId: string, recordingId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('handouts')
    .delete()
    .eq('user_id', userId)
    .eq('recording_id', recordingId);
  if (error) throw new Error(`deleteHandout: ${error.message}`);
}
