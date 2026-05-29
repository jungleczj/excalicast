import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getUserSubscription,
  listUserLibrary,
  upsertUserLibrary,
  deleteUserLibraryItem,
  type LibraryItemCloudRow,
} from '@/lib/db';
import { TIER_PERMISSIONS } from '@/types/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 返回 { userId, entitled } —— entitled 表示该用户有 cloudBackup（pro/max）。 */
async function authAndTier(): Promise<{ userId: string | null; entitled: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  if (!userId) return { userId: null, entitled: false };
  const sub = await getUserSubscription(userId);
  const tier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'inactive';
  const entitled =
    (status === 'active' || status === 'paused' ||
      (status === 'cancelled' && !!sub?.currentPeriodEnd && sub.currentPeriodEnd > Date.now()))
    && TIER_PERMISSIONS[tier].cloudBackup;
  return { userId, entitled };
}

export async function GET(): Promise<NextResponse> {
  const { userId, entitled } = await authAndTier();
  if (!userId || !entitled) {
    // 未登录 / 非 pro：返回空，客户端只用本地。
    return NextResponse.json({ items: [] });
  }
  const items = await listUserLibrary(userId);
  return NextResponse.json({ items });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { userId, entitled } = await authAndTier();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!entitled) {
    return NextResponse.json({ error: 'tier_required', message: '模板库云同步需要 Pro 订阅' }, { status: 403 });
  }
  let body: { items?: LibraryItemCloudRow[] };
  try {
    body = (await req.json()) as { items?: LibraryItemCloudRow[] };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ ok: true, count: 0 });
  await upsertUserLibrary(userId, items);
  return NextResponse.json({ ok: true, count: items.length });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const { userId, entitled } = await authAndTier();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!entitled) {
    return NextResponse.json({ error: 'tier_required' }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  await deleteUserLibraryItem(userId, id);
  return NextResponse.json({ ok: true });
}
