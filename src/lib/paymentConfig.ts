import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// payment_config — 单行表，控制支付提供商与定价。
//
// 任何字段都可以为空 / null —— 缺失时回退到 .env 里的对应默认值。
// 这样：
//   - 数据库空 → 行为完全等价于现状（Paddle 走环境变量）
//   - admin POST /api/admin/payment-config → 任意字段可改，立即生效
//
// 列同时支持 SQLite（开发回退）与 Supabase Postgres（生产）。
// ---------------------------------------------------------------------------

export type PaymentProvider = 'paddle' | 'creem';

export interface PaymentConfig {
  provider: PaymentProvider;
  currency: string;                // 'usd' | 'cny' | ...
  oneTimePriceCents: number;       // 显示价 + 入库记录用
  proMonthlyPriceCents: number;
  paddleOneTimePriceId: string | null;
  paddleProPriceId: string | null;
  creemOneTimeProductId: string | null;
  creemProProductId: string | null;
  updatedAt: number;
}

const DEFAULT_CONFIG: PaymentConfig = {
  provider: 'paddle',
  currency: 'usd',
  oneTimePriceCents: 300,
  proMonthlyPriceCents: 900,
  paddleOneTimePriceId: null,
  paddleProPriceId: null,
  creemOneTimeProductId: null,
  creemProProductId: null,
  updatedAt: 0,
};

function envDefaults(): PaymentConfig {
  return {
    ...DEFAULT_CONFIG,
    paddleOneTimePriceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID ?? null,
    paddleProPriceId: process.env.NEXT_PUBLIC_PADDLE_PRO_PRICE_ID ?? null,
    creemOneTimeProductId: process.env.CREEM_ONE_TIME_PRODUCT_ID ?? null,
    creemProProductId: process.env.CREEM_PRO_PRODUCT_ID ?? null,
  };
}

// ---------------------------------------------------------------------------
// Backend selection — same pattern as src/lib/db.ts
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
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'paddle',
      currency TEXT NOT NULL DEFAULT 'usd',
      one_time_price_cents INTEGER NOT NULL DEFAULT 300,
      pro_monthly_price_cents INTEGER NOT NULL DEFAULT 900,
      paddle_one_time_price_id TEXT,
      paddle_pro_price_id TEXT,
      creem_one_time_product_id TEXT,
      creem_pro_product_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  _db = db;
  return db;
}

interface SqliteConfigRow {
  id: number;
  provider: string;
  currency: string;
  one_time_price_cents: number;
  pro_monthly_price_cents: number;
  paddle_one_time_price_id: string | null;
  paddle_pro_price_id: string | null;
  creem_one_time_product_id: string | null;
  creem_pro_product_id: string | null;
  updated_at: number;
}

interface SupabaseConfigRow extends Omit<SqliteConfigRow, 'updated_at'> {
  updated_at: string;
}

function rowToConfig(row: SqliteConfigRow | null | undefined): PaymentConfig {
  const defaults = envDefaults();
  if (!row) return defaults;
  const provider = (row.provider === 'creem' ? 'creem' : 'paddle') as PaymentProvider;
  return {
    provider,
    currency: row.currency || defaults.currency,
    oneTimePriceCents: row.one_time_price_cents ?? defaults.oneTimePriceCents,
    proMonthlyPriceCents: row.pro_monthly_price_cents ?? defaults.proMonthlyPriceCents,
    paddleOneTimePriceId: row.paddle_one_time_price_id ?? defaults.paddleOneTimePriceId,
    paddleProPriceId: row.paddle_pro_price_id ?? defaults.paddleProPriceId,
    creemOneTimeProductId: row.creem_one_time_product_id ?? defaults.creemOneTimeProductId,
    creemProProductId: row.creem_pro_product_id ?? defaults.creemProProductId,
    updatedAt: row.updated_at ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getPaymentConfig(): Promise<PaymentConfig> {
  if (isSupabase()) {
    const { data, error } = await sb()
      .from('payment_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new Error(`getPaymentConfig: ${error.message}`);
    }
    if (!data) return envDefaults();
    const sup = data as SupabaseConfigRow;
    return rowToConfig({
      ...sup,
      updated_at: new Date(sup.updated_at).getTime(),
    });
  }
  const row = getDb()
    .prepare('SELECT * FROM payment_config WHERE id = 1')
    .get() as SqliteConfigRow | undefined;
  return rowToConfig(row);
}

export interface PaymentConfigPatch {
  provider?: PaymentProvider;
  currency?: string;
  oneTimePriceCents?: number;
  proMonthlyPriceCents?: number;
  paddleOneTimePriceId?: string | null;
  paddleProPriceId?: string | null;
  creemOneTimeProductId?: string | null;
  creemProProductId?: string | null;
}

export async function setPaymentConfig(patch: PaymentConfigPatch): Promise<PaymentConfig> {
  const current = await getPaymentConfig();
  const next: PaymentConfig = {
    provider: patch.provider ?? current.provider,
    currency: patch.currency ?? current.currency,
    oneTimePriceCents: patch.oneTimePriceCents ?? current.oneTimePriceCents,
    proMonthlyPriceCents: patch.proMonthlyPriceCents ?? current.proMonthlyPriceCents,
    paddleOneTimePriceId: patch.paddleOneTimePriceId !== undefined
      ? patch.paddleOneTimePriceId
      : current.paddleOneTimePriceId,
    paddleProPriceId: patch.paddleProPriceId !== undefined
      ? patch.paddleProPriceId
      : current.paddleProPriceId,
    creemOneTimeProductId: patch.creemOneTimeProductId !== undefined
      ? patch.creemOneTimeProductId
      : current.creemOneTimeProductId,
    creemProProductId: patch.creemProProductId !== undefined
      ? patch.creemProProductId
      : current.creemProProductId,
    updatedAt: Date.now(),
  };
  if (isSupabase()) {
    const { error } = await sb()
      .from('payment_config')
      .upsert(
        {
          id: 1,
          provider: next.provider,
          currency: next.currency,
          one_time_price_cents: next.oneTimePriceCents,
          pro_monthly_price_cents: next.proMonthlyPriceCents,
          paddle_one_time_price_id: next.paddleOneTimePriceId,
          paddle_pro_price_id: next.paddleProPriceId,
          creem_one_time_product_id: next.creemOneTimeProductId,
          creem_pro_product_id: next.creemProProductId,
          updated_at: new Date(next.updatedAt).toISOString(),
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(`setPaymentConfig: ${error.message}`);
    return next;
  }
  getDb()
    .prepare(
      `INSERT INTO payment_config (id, provider, currency, one_time_price_cents, pro_monthly_price_cents,
        paddle_one_time_price_id, paddle_pro_price_id, creem_one_time_product_id, creem_pro_product_id, updated_at)
       VALUES (1, @provider, @currency, @one_time, @pro_monthly, @paddle_one_time, @paddle_pro, @creem_one_time, @creem_pro, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider,
         currency = excluded.currency,
         one_time_price_cents = excluded.one_time_price_cents,
         pro_monthly_price_cents = excluded.pro_monthly_price_cents,
         paddle_one_time_price_id = excluded.paddle_one_time_price_id,
         paddle_pro_price_id = excluded.paddle_pro_price_id,
         creem_one_time_product_id = excluded.creem_one_time_product_id,
         creem_pro_product_id = excluded.creem_pro_product_id,
         updated_at = excluded.updated_at`,
    )
    .run({
      provider: next.provider,
      currency: next.currency,
      one_time: next.oneTimePriceCents,
      pro_monthly: next.proMonthlyPriceCents,
      paddle_one_time: next.paddleOneTimePriceId,
      paddle_pro: next.paddleProPriceId,
      creem_one_time: next.creemOneTimeProductId,
      creem_pro: next.creemProProductId,
      updated_at: next.updatedAt,
    });
  return next;
}

/**
 * 客户端可见的精简视图：不包含 product/price ID，只暴露选择和价格。
 * 这样后端切换 provider 不会让 UI 知道任何对应的支付商内部 ID。
 */
export interface PublicPaymentConfig {
  provider: PaymentProvider;
  currency: string;
  oneTimePriceCents: number;
  proMonthlyPriceCents: number;
}

export function toPublic(cfg: PaymentConfig): PublicPaymentConfig {
  return {
    provider: cfg.provider,
    currency: cfg.currency,
    oneTimePriceCents: cfg.oneTimePriceCents,
    proMonthlyPriceCents: cfg.proMonthlyPriceCents,
  };
}
