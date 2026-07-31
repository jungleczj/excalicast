import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FUNNEL_STEPS } from '@/lib/analytics/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 50000;

function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return NextResponse.json({ error: 'admin_secret_not_configured' }, { status: 403 });
  if (req.headers.get('x-admin-secret') !== expected) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

interface Row {
  event: string;
  user_id: string | null;
  guest_id: string | null;
  session_id: string | null;
  path: string | null;
  locale: string | null;
  props: Record<string, string | number | boolean> | null;
  created_at: string;
}

/** GET /api/admin/analytics?range=7|30|90 → 聚合分析数据。 */
export async function GET(req: Request): Promise<NextResponse> {
  const denied = checkAuth(req);
  if (denied) return denied;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const rangeDays = [7, 30, 90].includes(Number(url.searchParams.get('range'))) ? Number(url.searchParams.get('range')) : 30;
  const since = new Date(Date.now() - rangeDays * 86400_000).toISOString();

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from('analytics_events')
    .select('event, user_id, guest_id, session_id, path, locale, props, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Row[];

  const identity = (r: Row): string | null => r.user_id ?? (r.guest_id ? `g:${r.guest_id}` : null);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const sevenAgo = Date.now() - 7 * 86400_000;

  // summary
  const users = new Set<string>();
  let todayCount = 0;
  let last7dCount = 0;
  for (const r of rows) {
    const id = identity(r);
    if (id) users.add(id);
    const t = new Date(r.created_at).getTime();
    if (t >= startOfToday.getTime()) todayCount++;
    if (t >= sevenAgo) last7dCount++;
  }

  // byEvent
  const byEventMap = new Map<string, number>();
  for (const r of rows) byEventMap.set(r.event, (byEventMap.get(r.event) ?? 0) + 1);
  const byEvent = Array.from(byEventMap.entries()).map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count);

  // funnel：每级独立身份数
  const eventToIds = new Map<string, Set<string>>();
  for (const r of rows) {
    const id = identity(r);
    if (!id) continue;
    if (!eventToIds.has(r.event)) eventToIds.set(r.event, new Set());
    eventToIds.get(r.event)!.add(id);
  }
  const funnel = FUNNEL_STEPS.map((step) => ({ step, users: eventToIds.get(step)?.size ?? 0 }));

  // daily：近 30 天（或 range 内）每日事件数
  const dailyMap = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const daily: { day: string; count: number }[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    daily.push({ day: d, count: dailyMap.get(d) ?? 0 });
  }

  // recent
  const recent = rows.slice(0, 50).map((r) => ({
    event: r.event,
    who: r.user_id ? `u:${r.user_id.slice(0, 8)}` : r.guest_id ? `g:${r.guest_id.slice(0, 8)}` : '—',
    path: r.path ?? '',
    at: r.created_at,
  }));

  // Build one attribution record per session, then aggregate session outcomes.
  // This prevents comparison CTAs (which emit a generic and comparison event)
  // from being counted twice.
  interface AttributedSession {
    entryPath: string;
    contentType: string;
    slug: string;
    locale: string;
    sourceKind: string;
    trafficKind: string;
    events: Set<string>;
  }
  const attributedSessions = new Map<string, AttributedSession>();
  for (const row of rows) {
    const entryPath = typeof row.props?.entry_path === 'string' ? row.props.entry_path : '';
    const sessionKey = row.session_id ?? identity(row);
    if (!entryPath || !sessionKey) continue;
    const session = attributedSessions.get(sessionKey) ?? {
      entryPath,
      contentType: '',
      slug: '',
      locale: row.locale ?? '',
      sourceKind: '',
      trafficKind: typeof row.props?.traffic_kind === 'string' ? row.props.traffic_kind : '',
      events: new Set<string>(),
    };
    if (typeof row.props?.content_type === 'string') session.contentType = row.props.content_type;
    if (typeof row.props?.slug === 'string') session.slug = row.props.slug;
    if (typeof row.props?.source_kind === 'string') session.sourceKind = row.props.source_kind;
    if (!session.locale && row.locale) session.locale = row.locale;
    session.events.add(row.event);
    attributedSessions.set(sessionKey, session);
  }

  const acquisitionMap = new Map<string, {
    entryPath: string;
    contentType: string;
    slug: string;
    locale: string;
    sourceKind: string;
    trafficKind: string;
    sessions: number;
    ctaClicks: number;
    recordingStarts: number;
    recordingCompletes: number;
    exports: number;
  }>();
  for (const session of attributedSessions.values()) {
    const key = [
      session.entryPath,
      session.contentType,
      session.slug,
      session.locale,
      session.sourceKind,
      session.trafficKind,
    ].join('\u0000');
    const bucket = acquisitionMap.get(key) ?? {
      entryPath: session.entryPath,
      contentType: session.contentType,
      slug: session.slug,
      locale: session.locale,
      sourceKind: session.sourceKind,
      trafficKind: session.trafficKind,
      sessions: 0,
      ctaClicks: 0,
      recordingStarts: 0,
      recordingCompletes: 0,
      exports: 0,
    };
    bucket.sessions++;
    if (session.events.has('content_cta_click')) bucket.ctaClicks++;
    if (session.events.has('recording_start')) bucket.recordingStarts++;
    if (session.events.has('recording_complete')) bucket.recordingCompletes++;
    if (session.events.has('export_success')) bucket.exports++;
    acquisitionMap.set(key, bucket);
  }
  const acquisition = Array.from(acquisitionMap.entries())
    .map(([, value]) => value)
    .sort((a, b) => b.sessions - a.sessions);

  return NextResponse.json({
    range: rangeDays,
    capped: rows.length >= MAX_ROWS,
    summary: { totalEvents: rows.length, uniqueUsers: users.size, todayEvents: todayCount, last7dEvents: last7dCount },
    byEvent,
    funnel,
    daily,
    recent,
    acquisition,
  });
}
