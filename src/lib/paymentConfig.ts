import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// payment_config — 多行单表 + is_active 切换
//
// 4 行（每个 (provider, mode) 组合 1 行）：
//   id | is_active | provider | mode | currency | prices | api_key | webhook_secret | api_base | one_time_product_id | pro_product_id
//
// 当前生效的那行 (is_active=true) 唯一。Unique partial index 保底。
// /api/admin/payment-config 按 (provider, mode) upsert；/activate 端点事务切换 is_active。
//
// 兼容期：DB 字段为 null 时回退到对应 env 变量。
// ---------------------------------------------------------------------------

export type PaymentProvider = 'creem' | 'paddle';
export type PaymentMode = 'live' | 'test';

export interface PaymentConfigRow {
  id: number;
  isActive: boolean;
  provider: PaymentProvider;
  mode: PaymentMode;
  currency: string;
  oneTimePriceCents: number;
  proMonthlyPriceCents: number;
  apiKey: string | null;
  webhookSecret: string | null;
  apiBase: string | null;
  oneTimeProductId: string | null;
  proProductId: string | null;
  updatedAt: number;
}

/** Client-facing pruned view: secrets / product IDs never reach the browser. */
export interface PublicPaymentConfig {
  provider: PaymentProvider;
  mode: PaymentMode;
  currency: string;
  oneTimePriceCents: number;
  proMonthlyPriceCents: number;
}

export function toPublic(cfg: PaymentConfigRow): PublicPaymentConfig {
  return {
    provider: cfg.provider,
    mode: cfg.mode,
    currency: cfg.currency,
    oneTimePriceCents: cfg.oneTimePriceCents,
    proMonthlyPriceCents: cfg.proMonthlyPriceCents,
  };
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

function isSupabase(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'excalicast-payment-config' } },
  });
  return _sb;
}

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
    CREATE TABLE IF NOT EXISTS payment_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      is_active INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL CHECK (provider IN ('creem','paddle')),
      mode TEXT NOT NULL CHECK (mode IN ('live','test')),
      currency TEXT NOT NULL DEFAULT 'usd',
      one_time_price_cents INTEGER NOT NULL CHECK (one_time_price_cents >= 0),
      pro_monthly_price_cents INTEGER NOT NULL CHECK (pro_monthly_price_cents >= 0),
      api_key TEXT,
      webhook_secret TEXT,
      api_base TEXT,
      one_time_product_id TEXT,
      pro_product_id TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, mode)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_config
      ON payment_config (is_active) WHERE is_active = 1;
  `);
  // seed 4 行（首次启动时）
  const count = (db.prepare('SELECT COUNT(*) as n FROM payment_config').get() as { n: number }).n;
  if (count === 0) {
    const now = Date.now();
    const seedRow = db.prepare(`
      INSERT OR IGNORE INTO payment_config
        (is_active, provider, mode, currency, one_time_price_cents, pro_monthly_price_cents, api_base, updated_at)
      VALUES (?, ?, ?, 'usd', 300, 900, ?, ?)
    `);
    seedRow.run(1, 'creem', 'live', 'https://api.creem.io/v1', now);
    seedRow.run(0, 'creem', 'test', 'https://test-api.creem.io/v1', now);
    seedRow.run(0, 'paddle', 'live', null, now);
    seedRow.run(0, 'paddle', 'test', null, now);
  }
  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// Row deserialisation
// ---------------------------------------------------------------------------

interface SqliteRow {
  id: number;
  is_active: number;
  provider: string;
  mode: string;
  currency: string;
  one_time_price_cents: number;
  pro_monthly_price_cents: number;
  api_key: string | null;
  webhook_secret: string | null;
  api_base: string | null;
  one_time_product_id: string | null;
  pro_product_id: string | null;
  updated_at: number;
}

interface SupabaseRow extends Omit<SqliteRow, 'is_active' | 'updated_at'> {
  is_active: boolean;
  updated_at: string;
}

function fromSqliteRow(r: SqliteRow): PaymentConfigRow {
  return {
    id: r.id,
    isActive: r.is_active === 1,
    provider: (r.provider === 'paddle' ? 'paddle' : 'creem') as PaymentProvider,
    mode: (r.mode === 'test' ? 'test' : 'live') as PaymentMode,
    currency: r.currency,
    oneTimePriceCents: r.one_time_price_cents,
    proMonthlyPriceCents: r.pro_monthly_price_cents,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    apiBase: r.api_base,
    oneTimeProductId: r.one_time_product_id,
    proProductId: r.pro_product_id,
    updatedAt: r.updated_at,
  };
}

function fromSupabaseRow(r: SupabaseRow): PaymentConfigRow {
  return {
    id: r.id,
    isActive: r.is_active,
    provider: (r.provider === 'paddle' ? 'paddle' : 'creem') as PaymentProvider,
    mode: (r.mode === 'test' ? 'test' : 'live') as PaymentMode,
    currency: r.currency,
    oneTimePriceCents: r.one_time_price_cents,
    proMonthlyPriceCents: r.pro_monthly_price_cents,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    apiBase: r.api_base,
    oneTimeProductId: r.one_time_product_id,
    proProductId: r.pro_product_id,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

// ---------------------------------------------------------------------------
// Env fallback — read 兼容期 env defaults when DB fields are null
// ---------------------------------------------------------------------------

function applyEnvFallback(row: PaymentConfigRow): PaymentConfigRow {
  if (row.provider === 'creem') {
    return {
      ...row,
      apiKey: row.apiKey
        ?? (row.mode === 'test' ? process.env.CREEM_API_KEY_TEST : process.env.CREEM_API_KEY)
        ?? null,
      webhookSecret: row.webhookSecret
        ?? (row.mode === 'test' ? process.env.CREEM_WEBHOOK_SECRET_TEST : process.env.CREEM_WEBHOOK_SECRET)
        ?? null,
      apiBase: row.apiBase
        ?? (row.mode === 'test'
              ? (process.env.CREEM_API_BASE_TEST ?? 'https://test-api.creem.io/v1')
              : (process.env.CREEM_API_BASE ?? 'https://api.creem.io/v1')),
      oneTimeProductId: row.oneTimeProductId
        ?? (row.mode === 'live' ? (process.env.CREEM_ONE_TIME_PRODUCT_ID ?? null) : null),
      proProductId: row.proProductId
        ?? (row.mode === 'live' ? (process.env.CREEM_PRO_PRODUCT_ID ?? null) : null),
    };
  }
  // paddle: 价格 ID 走 env 兜底
  return {
    ...row,
    oneTimeProductId: row.oneTimeProductId
      ?? (row.mode === 'live' ? (process.env.NEXT_PUBLIC_PADDLE_PRICE_ID ?? null) : null),
    proProductId: row.proProductId
      ?? (row.mode === 'live' ? (process.env.NEXT_PUBLIC_PADDLE_PRO_PRICE_ID ?? null) : null),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the row currently flagged is_active=true. */
export async function getActiveConfig(): Promise<PaymentConfigRow | null> {
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('payment_config')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new Error(`getActiveConfig: ${error.message}`);
    }
    if (!data) return null;
    return applyEnvFallback(fromSupabaseRow(data as SupabaseRow));
  }
  const row = getDb()
    .prepare('SELECT * FROM payment_config WHERE is_active = 1 LIMIT 1')
    .get() as SqliteRow | undefined;
  if (!row) return null;
  return applyEnvFallback(fromSqliteRow(row));
}

/** Returns all 4 rows for admin GET. */
export async function listAllConfigs(): Promise<PaymentConfigRow[]> {
  if (isSupabase()) {
    const { data, error } = await sb().from('payment_config').select('*').order('id');
    if (error) throw new Error(`listAllConfigs: ${error.message}`);
    return (data as SupabaseRow[]).map((r) => applyEnvFallback(fromSupabaseRow(r)));
  }
  const rows = getDb()
    .prepare('SELECT * FROM payment_config ORDER BY id')
    .all() as SqliteRow[];
  return rows.map((r) => applyEnvFallback(fromSqliteRow(r)));
}

/**
 * Get the row for a specific (provider, mode). Returns null if not present.
 * Used by:
 *   - upsert flow (read current → merge patch → write)
 *   - admin GET on a single row
 */
export async function getConfigByProviderMode(
  provider: PaymentProvider,
  mode: PaymentMode,
): Promise<PaymentConfigRow | null> {
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('payment_config')
      .select('*')
      .eq('provider', provider)
      .eq('mode', mode)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new Error(`getConfigByProviderMode: ${error.message}`);
    }
    if (!data) return null;
    return applyEnvFallback(fromSupabaseRow(data as SupabaseRow));
  }
  const row = getDb()
    .prepare('SELECT * FROM payment_config WHERE provider = ? AND mode = ?')
    .get(provider, mode) as SqliteRow | undefined;
  return row ? applyEnvFallback(fromSqliteRow(row)) : null;
}

/**
 * Returns all configured Creem webhook secrets (from every creem row plus
 * env fallback). Used by the webhook handler to try all candidates so old
 * in-flight retries from the other mode still verify.
 */
export async function getAllCreemWebhookSecrets(): Promise<string[]> {
  const all = await listAllConfigs();
  const secrets = new Set<string>();
  for (const row of all) {
    if (row.provider === 'creem' && row.webhookSecret) {
      secrets.add(row.webhookSecret);
    }
  }
  // Defensive env fallbacks
  for (const e of [process.env.CREEM_WEBHOOK_SECRET, process.env.CREEM_WEBHOOK_SECRET_TEST]) {
    if (e) secrets.add(e);
  }
  return Array.from(secrets);
}

// ---------------------------------------------------------------------------
// Mutation API
// ---------------------------------------------------------------------------

export interface PaymentConfigPatch {
  provider: PaymentProvider;
  mode: PaymentMode;
  currency?: string;
  oneTimePriceCents?: number;
  proMonthlyPriceCents?: number;
  apiKey?: string | null;
  webhookSecret?: string | null;
  apiBase?: string | null;
  oneTimeProductId?: string | null;
  proProductId?: string | null;
}

/**
 * Upsert a row identified by (provider, mode). Only provided fields are
 * updated; unset fields preserve current values. Pass `null` explicitly to
 * clear a field.
 *
 * Does NOT touch is_active — use activateConfig() to switch.
 */
export async function upsertConfigRow(patch: PaymentConfigPatch): Promise<PaymentConfigRow> {
  const existing = await getConfigByProviderMode(patch.provider, patch.mode);
  const now = Date.now();

  const merge = <T>(provided: T | undefined, fallback: T): T =>
    provided === undefined ? fallback : provided;

  const next: Omit<PaymentConfigRow, 'id' | 'isActive' | 'updatedAt'> = {
    provider: patch.provider,
    mode: patch.mode,
    currency: merge(patch.currency, existing?.currency ?? 'usd'),
    oneTimePriceCents: merge(patch.oneTimePriceCents, existing?.oneTimePriceCents ?? 300),
    proMonthlyPriceCents: merge(patch.proMonthlyPriceCents, existing?.proMonthlyPriceCents ?? 900),
    apiKey: merge(patch.apiKey, existing?.apiKey ?? null),
    webhookSecret: merge(patch.webhookSecret, existing?.webhookSecret ?? null),
    apiBase: merge(patch.apiBase, existing?.apiBase ?? null),
    oneTimeProductId: merge(patch.oneTimeProductId, existing?.oneTimeProductId ?? null),
    proProductId: merge(patch.proProductId, existing?.proProductId ?? null),
  };

  if (isSupabase()) {
    const { data, error } = await sb()
      .from('payment_config')
      .upsert(
        {
          provider: next.provider,
          mode: next.mode,
          currency: next.currency,
          one_time_price_cents: next.oneTimePriceCents,
          pro_monthly_price_cents: next.proMonthlyPriceCents,
          api_key: next.apiKey,
          webhook_secret: next.webhookSecret,
          api_base: next.apiBase,
          one_time_product_id: next.oneTimeProductId,
          pro_product_id: next.proProductId,
        },
        { onConflict: 'provider,mode' },
      )
      .select()
      .single();
    if (error) throw new Error(`upsertConfigRow: ${error.message}`);
    return applyEnvFallback(fromSupabaseRow(data as SupabaseRow));
  }

  getDb()
    .prepare(
      `INSERT INTO payment_config
         (is_active, provider, mode, currency, one_time_price_cents, pro_monthly_price_cents,
          api_key, webhook_secret, api_base, one_time_product_id, pro_product_id, updated_at)
       VALUES (0, @provider, @mode, @currency, @oneTime, @proMonthly,
               @apiKey, @webhookSecret, @apiBase, @oneTimeProductId, @proProductId, @updatedAt)
       ON CONFLICT (provider, mode) DO UPDATE SET
         currency = excluded.currency,
         one_time_price_cents = excluded.one_time_price_cents,
         pro_monthly_price_cents = excluded.pro_monthly_price_cents,
         api_key = excluded.api_key,
         webhook_secret = excluded.webhook_secret,
         api_base = excluded.api_base,
         one_time_product_id = excluded.one_time_product_id,
         pro_product_id = excluded.pro_product_id,
         updated_at = excluded.updated_at`,
    )
    .run({
      provider: next.provider,
      mode: next.mode,
      currency: next.currency,
      oneTime: next.oneTimePriceCents,
      proMonthly: next.proMonthlyPriceCents,
      apiKey: next.apiKey,
      webhookSecret: next.webhookSecret,
      apiBase: next.apiBase,
      oneTimeProductId: next.oneTimeProductId,
      proProductId: next.proProductId,
      updatedAt: now,
    });

  const row = getDb()
    .prepare('SELECT * FROM payment_config WHERE provider = ? AND mode = ?')
    .get(next.provider, next.mode) as SqliteRow;
  return applyEnvFallback(fromSqliteRow(row));
}

/**
 * Activate a specific (provider, mode) row. Transactionally:
 *   1. UPDATE ... SET is_active=FALSE WHERE is_active=TRUE
 *   2. UPDATE ... SET is_active=TRUE  WHERE provider=$1 AND mode=$2
 *
 * Throws if no such row exists.
 */
export async function activateConfig(
  provider: PaymentProvider,
  mode: PaymentMode,
): Promise<PaymentConfigRow> {
  if (isSupabase()) {
    // No client-side transaction support → two updates back-to-back.
    // The unique partial index on is_active=true is the integrity backstop;
    // if a race produces two TRUEs the second write fails and we surface it.
    const { error: e1 } = await sb()
      .from('payment_config')
      .update({ is_active: false })
      .eq('is_active', true);
    if (e1) throw new Error(`activateConfig (clear): ${e1.message}`);

    const { data, error: e2 } = await sb()
      .from('payment_config')
      .update({ is_active: true })
      .eq('provider', provider)
      .eq('mode', mode)
      .select()
      .single();
    if (e2) throw new Error(`activateConfig (set): ${e2.message}`);
    if (!data) throw new Error(`activateConfig: no row for ${provider}/${mode}`);
    return applyEnvFallback(fromSupabaseRow(data as SupabaseRow));
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('UPDATE payment_config SET is_active = 0 WHERE is_active = 1').run();
    const r = db.prepare('UPDATE payment_config SET is_active = 1 WHERE provider = ? AND mode = ?')
      .run(provider, mode);
    if (r.changes === 0) throw new Error(`activateConfig: no row for ${provider}/${mode}`);
  });
  tx();

  const row = db.prepare('SELECT * FROM payment_config WHERE is_active = 1').get() as SqliteRow;
  return applyEnvFallback(fromSqliteRow(row));
}

// formatPrice lives in @/lib/formatPrice so it can be bundled into the client.
export { formatPrice } from './formatPrice';

// ---------------------------------------------------------------------------
// Mismatch error for Creem write-time validation
// ---------------------------------------------------------------------------

export class PaymentConfigMismatchError extends Error {
  constructor(
    public field: string,
    public dbValue: unknown,
    public creemValue: unknown,
    public productId: string,
  ) {
    super(`payment_config mismatch: ${field}: db=${JSON.stringify(dbValue)} creem=${JSON.stringify(creemValue)} (product=${productId})`);
    this.name = 'PaymentConfigMismatchError';
  }
}
