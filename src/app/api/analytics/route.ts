import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { KNOWN_EVENT_SET } from '@/lib/analytics/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ok = () => new NextResponse(null, { status: 204 });

/**
 * 关键事件写入。客户端 trackEvent 用 sendBeacon POST 到这里。
 * 始终回 204（不阻塞、不暴露内部状态）。非白名单事件 / 无 Supabase 配置直接丢弃。
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return ok();

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return ok(); }

  const event = typeof body.event === 'string' ? body.event : '';
  if (!KNOWN_EVENT_SET.has(event)) return ok();

  // props：限字段数 + 字符串长度，只收原始标量
  const props: Record<string, string | number | boolean> = {};
  if (body.props && typeof body.props === 'object' && !Array.isArray(body.props)) {
    for (const [k, v] of Object.entries(body.props as Record<string, unknown>).slice(0, 24)) {
      if (typeof v === 'string') props[k] = v.slice(0, 200);
      else if (typeof v === 'number' || typeof v === 'boolean') props[k] = v;
    }
  }

  // 登录用户 id（匿名为 null，靠 guest_id 关联）
  let userId: string | null = null;
  try {
    const supa = await createSupabaseServerClient();
    const { data } = await supa.auth.getUser();
    userId = data.user?.id ?? null;
  } catch { /* ignore */ }

  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);

  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.from('analytics_events').insert({
      event,
      props,
      user_id: userId,
      guest_id: str(body.guestId, 64),
      session_id: str(body.sessionId, 64),
      path: str(body.path, 256),
      locale: str(body.locale, 16),
      referrer: (req.headers.get('referer') ?? '').slice(0, 256) || null,
      ua: (req.headers.get('user-agent') ?? '').slice(0, 256) || null,
    });
  } catch { /* 静默：分析写入失败绝不影响用户 */ }

  return ok();
}
