import crypto from 'node:crypto';

export interface PaddleTransactionCompleted {
  transactionId: string;
  recordingId: string;
  amountCents: number;
  currency: string;
}

/**
 * Verify Paddle webhook signature.
 * Header format: `Paddle-Signature: ts=<unix>;h1=<hex hmac>`
 * HMAC input: `${ts}:${rawBody}` (NOT the bare body — Paddle-specific)
 * Algorithm: HMAC-SHA256 with PADDLE_WEBHOOK_SECRET.
 *
 * Spec: https://developer.paddle.com/webhooks/signature-verification
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return process.env.DEV_MODE === 'true';
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(';').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > 300) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Parse a `transaction.completed` Paddle webhook payload into our internal shape.
 * Returns null if event_type is not `transaction.completed` or required fields are missing.
 */
export function parseTransactionCompleted(payload: unknown): PaddleTransactionCompleted | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.event_type !== 'transaction.completed') return null;

  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const transactionId = typeof data.id === 'string' ? data.id : '';
  if (!transactionId) return null;

  const customData = data.custom_data as Record<string, unknown> | undefined;
  const recordingId = customData && typeof customData.recordingId === 'string'
    ? customData.recordingId
    : '';
  if (!recordingId) return null;

  const currency = typeof data.currency_code === 'string' ? data.currency_code.toLowerCase() : 'usd';

  const details = data.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const totalRaw = totals?.total;
  const amountCents = typeof totalRaw === 'string' ? Number(totalRaw) : Number(totalRaw ?? 0);

  return {
    transactionId,
    recordingId,
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    currency,
  };
}
