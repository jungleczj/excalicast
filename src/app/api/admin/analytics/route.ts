import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  aggregateAdminAnalytics,
  parseAdminAnalyticsQuery,
  type AnalyticsEventRow,
} from '@/lib/analytics/adminAggregation';
import { resolveAnalyticsServerConfig } from '@/lib/analytics/adminConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 50_000;

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_SECRET;
  const received = req.headers.get('x-admin-secret');
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

/** GET /api/admin/analytics: administrator-only aggregate conversion analytics. */
export async function GET(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const config = resolveAnalyticsServerConfig({
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!config) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const query = parseAdminAnalyticsQuery(new URL(req.url));
  const admin = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .from('analytics_events')
    .select('event, user_id, guest_id, session_id, path, locale, props, created_at')
    .gte('created_at', query.from)
    .lte('created_at', query.to)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as AnalyticsEventRow[];
  const aggregate = aggregateAdminAnalytics(rows, { groupBy: query.groupBy, filters: query.filters });

  const byEventMap = new Map<string, number>();
  const dailyMap = new Map<string, number>();
  for (const row of rows) {
    byEventMap.set(row.event, (byEventMap.get(row.event) ?? 0) + 1);
    const day = row.created_at.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }

  return NextResponse.json({
    query,
    capped: rows.length >= MAX_ROWS,
    paymentCoverage: 'client_confirmed',
    ...aggregate,
    byEvent: Array.from(byEventMap, ([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count),
    daily: Array.from(dailyMap, ([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
  });
}
