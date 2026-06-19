import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { activateConfig, getActiveConfig, toPublic } from '@/lib/paymentConfig';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only：切换激活行。
 *
 * POST body: { provider: 'creem'|'paddle', mode: 'live'|'test' }
 *
 * 事务内：先把 is_active=TRUE 的那行 set FALSE，再 set 目标行 TRUE。
 * 成功后通过 Supabase Realtime broadcast 通知所有在线客户端。
 */

function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'admin_secret_not_configured' }, { status: 403 });
  }
  const got = req.headers.get('x-admin-secret');
  if (got !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: { provider?: string; mode?: string };
  try {
    body = (await req.json()) as { provider?: string; mode?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (body.provider !== 'creem' && body.provider !== 'paddle') {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
  }
  if (body.mode !== 'live' && body.mode !== 'test') {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }

  try {
    const row = await activateConfig(body.provider, body.mode);
    await broadcastActive();
    revalidatePath('/', 'layout'); // 价格页走 ISR，切换 mode 后立即再生
    return NextResponse.json({ ok: true, active: row });
  } catch (err) {
    return NextResponse.json({
      error: 'activate_failed',
      message: err instanceof Error ? err.message : 'unknown',
    }, { status: 500 });
  }
}

async function broadcastActive(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const active = await getActiveConfig();
    if (!active) return;
    const ch = supa.channel('payment-config-broadcast');
    await ch.subscribe();
    await ch.send({
      type: 'broadcast',
      event: 'updated',
      payload: toPublic(active),
    });
    await supa.removeChannel(ch);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin/payment-config/activate] broadcast failed:', err instanceof Error ? err.message : err);
  }
}
