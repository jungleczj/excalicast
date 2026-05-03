import crypto from 'node:crypto';

export interface CreemCheckoutSession {
  id: string;
  url: string;
}

export interface CreemWebhookEvent {
  type: string;
  data: {
    sessionId: string;
    metadata: { recordingId?: string; [key: string]: string | undefined };
    amountCents: number;
    currency: string;
    status: 'paid' | 'failed' | 'pending';
  };
}

const CREEM_API_BASE = 'https://api.creem.io/v1';

/**
 * 创建 Creem Checkout 会话。
 * 真实实现：POST {CREEM_API_BASE}/checkouts，附 productId、metadata、success_url。
 * 当前未配置 CREEM_API_KEY 时返回本地模拟 URL，便于开发联调。
 */
export async function createCheckoutSession(params: {
  recordingId: string;
  amountCents: number;
  currency: string;
  successUrl: string;
}): Promise<CreemCheckoutSession> {
  const apiKey = process.env.CREEM_API_KEY;
  const productId = process.env.CREEM_PRODUCT_ID;

  if (!apiKey || !productId) {
    const sessionId = `dev_sess_${crypto.randomUUID()}`;
    const sep = params.successUrl.includes('?') ? '&' : '?';
    const successUrl = `${params.successUrl}${sep}creem_session_id=${sessionId}&dev=1`;
    return { id: sessionId, url: successUrl };
  }

  const res = await fetch(`${CREEM_API_BASE}/checkouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      product_id: productId,
      success_url: params.successUrl,
      metadata: { recordingId: params.recordingId },
      amount: params.amountCents,
      currency: params.currency,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Creem checkout failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id: string; url: string };
  return { id: json.id, url: json.url };
}

/**
 * 校验 Creem webhook 签名。
 * Creem 推荐做法：HMAC-SHA256(rawBody, webhookSecret)，与 header 中的 `creem-signature` 比较。
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) return process.env.DEV_MODE === 'true';
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * 把 Creem webhook payload 规范化成内部事件格式。
 * 真实 schema 以 Creem 文档为准；当前根据公开示例兼容多种字段位置。
 */
export function parseWebhookPayload(payload: unknown): CreemWebhookEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : (typeof p.event === 'string' ? p.event : '');
  const data = (p.data ?? p.object ?? p) as Record<string, unknown>;
  const metadata = (data.metadata ?? {}) as Record<string, string | undefined>;
  const sessionId = String(data.id ?? data.session_id ?? data.checkout_id ?? '');
  if (!sessionId) return null;
  const amountCents = Number(data.amount ?? data.amount_total ?? 0);
  const currency = String(data.currency ?? 'usd');
  const status = (data.status ?? data.payment_status ?? 'pending') as 'paid' | 'failed' | 'pending';
  return {
    type,
    data: { sessionId, metadata, amountCents, currency, status },
  };
}
