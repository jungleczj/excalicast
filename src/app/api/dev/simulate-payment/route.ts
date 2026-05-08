import { NextResponse } from 'next/server';
import { markRecordingPaid } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 开发专用：直接把 recordingId 写入 paid_recordings 表，模拟 Paddle 支付完成。
 * 上线前必须确保此路由仅在 DEV_MODE=true 时启用。
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (process.env.DEV_MODE !== 'true') {
    return NextResponse.json({ error: 'dev_mode_disabled' }, { status: 403 });
  }
  let body: { recordingId?: string };
  try {
    body = (await req.json()) as { recordingId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId) {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }
  const amountCents = Number(process.env.SINGLE_PURCHASE_PRICE_CENTS ?? 300);
  const currency = String(process.env.SINGLE_PURCHASE_CURRENCY ?? 'usd');
  markRecordingPaid({
    recordingId,
    amountCents,
    currency,
    paddleTransactionId: `dev_simulated_${Date.now()}`,
    rawPayload: JSON.stringify({ simulated: true, recordingId }),
  });
  return NextResponse.json({ ok: true, recordingId });
}
