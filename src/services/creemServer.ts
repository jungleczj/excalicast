/**
 * Creem 支付接入（服务端专用）。
 *
 * 文档：https://docs.creem.io/api-reference
 *
 * 关键点：
 *   - 鉴权头：`x-api-key: creem_<KEY>`
 *   - Base URL：test = https://test-api.creem.io/v1，prod = https://api.creem.io/v1
 *   - 创建 checkout：POST /checkouts → 返回 { id, checkout_url, status, ... }
 *   - product_id 决定 one-time vs subscription（Creem 后台配 billing_type）
 *   - metadata 会在 webhook 回传，把 recordingId / userId 放这里
 *   - webhook 签名头：`creem-signature`，HMAC-SHA256(rawBody, webhookSecret)
 *
 * 凭证来源：调用方从 payment_config 表的 active 行取出 { apiKey, apiBase, webhookSecret }
 * 传入。本模块不再读 `process.env.CREEM_*`（兜底由 paymentConfig.ts 的 applyEnvFallback
 * 在 DB 层完成）。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CreemCreds {
  apiKey: string;
  apiBase: string;
}

export interface CreateCheckoutOptions {
  creds: CreemCreds;
  productId: string;
  successUrl: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  requestId?: string;
}

export interface CreateCheckoutResult {
  id: string;
  checkoutUrl: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Credential introspection (无网络调用，仅按前缀 / host 推断模式)
// ---------------------------------------------------------------------------

export type CreemMode = 'live' | 'test' | 'unknown';

export function inferKeyMode(apiKey: string): CreemMode {
  if (!apiKey) return 'unknown';
  if (apiKey.startsWith('creem_test_')) return 'test';
  if (apiKey.startsWith('creem_live_')) return 'live';
  return 'unknown';
}

export function inferBaseMode(apiBase: string): CreemMode {
  if (!apiBase) return 'unknown';
  if (apiBase.includes('test-api.creem.io')) return 'test';
  // 注意：'test-api.creem.io' 也包含 'api.creem.io'，所以先判 test
  if (apiBase.includes('api.creem.io')) return 'live';
  return 'unknown';
}

export interface CreemCredsDiagnostic {
  keyMode: CreemMode;
  baseMode: CreemMode;
  apiBaseHost: string | null;
  keyPrefix: string;        // 仅展示前 11 字符（包含 `creem_live_` / `creem_test_`）
  keySuffix: string;        // 仅展示后 4 字符
  mismatch: boolean;
}

export function diagnoseCreemCreds(creds: CreemCreds): CreemCredsDiagnostic {
  const keyMode = inferKeyMode(creds.apiKey);
  const baseMode = inferBaseMode(creds.apiBase);
  let host: string | null = null;
  try { host = new URL(creds.apiBase).host; } catch { /* ignore */ }
  return {
    keyMode,
    baseMode,
    apiBaseHost: host,
    keyPrefix: (creds.apiKey ?? '').slice(0, 11),
    keySuffix: (creds.apiKey ?? '').slice(-4),
    mismatch: keyMode !== 'unknown' && baseMode !== 'unknown' && keyMode !== baseMode,
  };
}

function describeMismatch(diag: CreemCredsDiagnostic): string {
  return (
    `apiKey 是 ${diag.keyMode} 模式（前缀 ${diag.keyPrefix}…），` +
    `但 apiBase 指向 ${diag.baseMode} 模式（${diag.apiBaseHost ?? 'unknown'}）。` +
    `请去 admin：POST /api/admin/payment-config/activate 切换 active 行，` +
    `或 POST /api/admin/payment-config 改 apiBase/apiKey。`
  );
}

/**
 * 创建 Creem checkout（one-time 或 subscription，由 productId 的 billing_type 决定）。
 */
export async function createCreemCheckout(
  opts: CreateCheckoutOptions,
): Promise<CreateCheckoutResult> {
  if (!opts.creds.apiKey) throw new Error('createCreemCheckout: apiKey is empty');
  if (!opts.creds.apiBase) throw new Error('createCreemCheckout: apiBase is empty');

  // Fail-fast：调用 Creem 之前先看 apiKey 前缀和 apiBase host 是否一致
  const diag = diagnoseCreemCreds(opts.creds);
  if (diag.mismatch) {
    throw new Error(`Creem 配置错配：${describeMismatch(diag)}`);
  }

  const body: Record<string, unknown> = {
    product_id: opts.productId,
    success_url: opts.successUrl,
  };
  if (opts.metadata) body.metadata = opts.metadata;
  if (opts.customerEmail) body.customer = { email: opts.customerEmail };
  if (opts.requestId) body.request_id = opts.requestId;

  const res = await fetch(`${opts.creds.apiBase}/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': opts.creds.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: { id?: string; checkout_url?: string; status?: string; message?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Creem returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[creem] auth failed status=${res.status} host=${diag.apiBaseHost} ` +
        `keyMode=${diag.keyMode} baseMode=${diag.baseMode} prefix=${diag.keyPrefix}…${diag.keySuffix}`,
      );
      throw new Error(
        `Creem 鉴权失败 (${res.status}): ${json.message ?? 'Invalid API Key'}. ` +
        `当前配对：keyMode=${diag.keyMode}, baseHost=${diag.apiBaseHost ?? '?'}, ` +
        `keyPrefix=${diag.keyPrefix}…${diag.keySuffix}。` +
        `常见原因：(a) Creem dashboard 已经重置过 key 但 DB 没更新； ` +
        `(b) active 行的 mode 与 apiKey 实际模式不匹配。 ` +
        `可访问 GET /api/admin/payment-config/diagnose 自检（带 x-admin-secret 头）。`,
      );
    }
    throw new Error(
      `Creem checkout failed (${res.status}): ${json.message ?? text.slice(0, 200)}`,
    );
  }
  if (!json.id || !json.checkout_url) {
    throw new Error(`Creem checkout missing id/checkout_url: ${JSON.stringify(json)}`);
  }
  return {
    id: json.id,
    checkoutUrl: json.checkout_url,
    status: json.status ?? 'pending',
  };
}

// ---------------------------------------------------------------------------
// Product lookup for admin write-time price validation
// ---------------------------------------------------------------------------

export interface CreemProduct {
  id: string;
  priceCents: number;
  currency: string;
  billingType: string;
}

/** GET /v1/products/{id} — used by admin POST to verify DB price matches Creem. */
export async function fetchCreemProduct(
  productId: string,
  creds: CreemCreds,
): Promise<CreemProduct> {
  if (!creds.apiKey || !creds.apiBase) {
    throw new Error('fetchCreemProduct: missing apiKey/apiBase');
  }
  const res = await fetch(`${creds.apiBase}/products/${encodeURIComponent(productId)}`, {
    headers: { 'x-api-key': creds.apiKey },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new Error(`Creem product fetch non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = (json.message as string | undefined) ?? text.slice(0, 200);
    throw new Error(`Creem product fetch failed (${res.status}): ${msg}`);
  }
  // Creem 返回的价格字段历史上叫过 `price`, `amount`, `unit_amount` 等，这里都试一下
  const priceCents =
    numField(json, 'price') ??
    numField(json, 'amount') ??
    numField(json, 'unit_amount') ??
    numField(json, 'price_cents') ??
    0;
  const currency = ((json.currency as string | undefined) ?? 'usd').toLowerCase();
  const billingType = (json.billing_type as string | undefined) ?? 'one_time';
  return { id: productId, priceCents, currency, billingType };
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * 验签：HMAC-SHA256(rawBody, secret) === header['creem-signature']
 * 尝试 candidates 中的每个 secret（live + test 同时存在时，老的在飞 webhook
 * 仍能被验通）。任一通过即算合法。
 */
export function verifyCreemWebhook(
  rawBody: string,
  signature: string | null,
  candidates: string[],
): boolean {
  if (!signature) return false;
  if (candidates.length === 0) return false;

  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (sigBuf.length === 0) return false;

  for (const secret of candidates) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    try {
      const expBuf = Buffer.from(expected, 'hex');
      if (expBuf.length !== sigBuf.length) continue;
      if (timingSafeEqual(expBuf, sigBuf)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Webhook payload parsing — minimal, defensive subset.
//
// Creem 发的事件结构示例（按 docs）：
// {
//   "id": "evt_...",
//   "eventType": "checkout.completed",
//   "createdAt": 1700000000,
//   "object": { ...CheckoutEntity or SubscriptionEntity... }
// }
// ---------------------------------------------------------------------------

export interface CreemEvent {
  eventType: string;
  // 原始 object，下游按需 cast
  object: Record<string, unknown>;
  // 便利字段：把常见 metadata 拍平
  metadata: Record<string, string>;
}

export function parseCreemEvent(payload: unknown): CreemEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const eventType =
    typeof p.eventType === 'string'
      ? p.eventType
      : typeof p.event_type === 'string'
        ? p.event_type
        : typeof p.type === 'string'
          ? p.type
          : null;
  if (!eventType) return null;
  const objRaw =
    (p.object as Record<string, unknown> | undefined) ??
    (p.data as Record<string, unknown> | undefined) ??
    p;
  const obj = (objRaw ?? {}) as Record<string, unknown>;

  const metaRaw =
    (obj.metadata as Record<string, unknown> | undefined) ??
    ((obj.checkout as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined) ??
    {};
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(metaRaw)) {
    if (typeof v === 'string') metadata[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') metadata[k] = String(v);
  }

  return { eventType, object: obj, metadata };
}

/**
 * 从 Creem 事件里抽出我们关心的字段。
 *
 * one-time 和 subscription 都走同一个 webhook，按 eventType 分发：
 *   - `checkout.completed` + metadata.kind=='one_time'  → 单次去水印
 *   - `subscription.active` / `subscription.paid`       → Pro 生效
 *   - `subscription.canceled`                           → Pro 取消
 */
export interface CreemOneTimePaid {
  kind: 'one_time';
  recordingId: string;
  amountCents: number;
  currency: string;
  transactionId: string;
}

export interface CreemSubscriptionEvent {
  kind: 'subscription';
  status: 'active' | 'cancelled' | 'paused' | 'past_due';
  userId: string;
  subscriptionId: string;
  customerId: string | null;
  currentPeriodEnd: number | null;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function extractOneTimePaid(ev: CreemEvent): CreemOneTimePaid | null {
  if (ev.eventType !== 'checkout.completed') return null;
  if (ev.metadata.kind !== 'one_time') return null;
  const recordingId = ev.metadata.recordingId;
  if (!recordingId) return null;

  const order = (ev.object.order as Record<string, unknown> | undefined) ?? ev.object;
  const amountCents =
    num(order.amount) ||
    num(order.total_amount) ||
    num((order as { amount_total?: unknown }).amount_total);
  const currency = str(order.currency, 'usd').toLowerCase();
  const transactionId = str(order.id) || str(ev.object.id) || `creem_unknown_${Date.now()}`;

  return { kind: 'one_time', recordingId, amountCents, currency, transactionId };
}

export function extractSubscriptionEvent(ev: CreemEvent): CreemSubscriptionEvent | null {
  const t = ev.eventType;
  if (
    t !== 'subscription.active' &&
    t !== 'subscription.paid' &&
    t !== 'subscription.canceled' &&
    t !== 'subscription.paused' &&
    t !== 'subscription.past_due' &&
    t !== 'checkout.completed'
  ) {
    return null;
  }

  // subscription kind path
  const isSubscriptionEvent = t.startsWith('subscription.');
  const isCheckoutForSub =
    t === 'checkout.completed' && ev.metadata.kind === 'pro_subscription';
  if (!isSubscriptionEvent && !isCheckoutForSub) return null;

  const userId = ev.metadata.userId;
  if (!userId) return null;

  const sub =
    (ev.object.subscription as Record<string, unknown> | undefined) ??
    ev.object;

  const status: CreemSubscriptionEvent['status'] = (() => {
    if (t === 'subscription.canceled') return 'cancelled';
    if (t === 'subscription.paused') return 'paused';
    if (t === 'subscription.past_due') return 'past_due';
    return 'active';
  })();

  const subscriptionId = str(sub.id) || str(ev.object.id) || `creem_sub_unknown_${Date.now()}`;
  const customerId = str(sub.customer_id) || str((ev.object.customer as { id?: string } | undefined)?.id) || null;

  const periodEndRaw =
    sub.current_period_end ??
    sub.currentPeriodEnd ??
    sub.next_billing_date;
  const currentPeriodEnd = (() => {
    if (typeof periodEndRaw === 'number') {
      // Heuristic: seconds → ms
      return periodEndRaw < 10_000_000_000 ? periodEndRaw * 1000 : periodEndRaw;
    }
    if (typeof periodEndRaw === 'string') {
      const t = Date.parse(periodEndRaw);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  })();

  return {
    kind: 'subscription',
    status,
    userId,
    subscriptionId,
    customerId,
    currentPeriodEnd,
  };
}
