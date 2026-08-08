import { expect, test } from '@playwright/test';
import {
  aggregateAdminAnalytics,
  parseAdminAnalyticsQuery,
  type AnalyticsEventRow,
} from '@/lib/analytics/adminAggregation';
import { KNOWN_EVENT_SET } from '@/lib/analytics/events';
import { resolveAnalyticsServerConfig } from '@/lib/analytics/adminConfig';

const base = Date.parse('2026-08-01T00:00:00.000Z');

function event(
  seconds: number,
  name: string,
  sessionId: string,
  props: Record<string, string | number | boolean> = {},
): AnalyticsEventRow {
  return {
    event: name,
    user_id: null,
    guest_id: `guest-${sessionId}`,
    session_id: sessionId,
    path: props.entry_path?.toString() ?? '/zh',
    locale: props.locale?.toString() ?? 'zh',
    props,
    created_at: new Date(base + seconds * 1000).toISOString(),
  };
}

test('builds a sequential conversion funnel with CTR and drop-off rates', () => {
  const rows = [
    event(0, 'page_view', 'paid'),
    event(2, 'content_cta_click', 'paid'),
    event(5, 'recording_start', 'paid'),
    event(15, 'recording_complete', 'paid'),
    event(20, 'export_success', 'paid'),
    event(25, 'checkout_start', 'paid'),
    event(35, 'purchase_success', 'paid'),
    event(40, 'page_view', 'left-at-cta'),
    event(45, 'content_cta_click', 'left-at-cta'),
    event(50, 'page_view', 'left-on-page'),
  ];

  const result = aggregateAdminAnalytics(rows, { groupBy: 'none' });

  expect(result.summary).toMatchObject({ pageViews: 3, ctaClicks: 2, ctr: 66.7, paid: 1 });
  expect(result.funnel.map(({ step, users }) => [step, users])).toEqual([
    ['page_view', 3],
    ['cta_click', 2],
    ['recording_start', 1],
    ['recording_complete', 1],
    ['export_success', 1],
    ['checkout_start', 1],
    ['purchase_success', 1],
  ]);
  expect(result.funnel[0]).toMatchObject({ conversionRate: 100, dropoffRate: 33.3 });
  expect(result.funnel[1]).toMatchObject({ conversionRate: 66.7, dropoffRate: 50 });
});

test('counts a step only when the session reached preceding steps in order', () => {
  const rows = [
    event(0, 'page_view', 'valid'),
    event(1, 'content_cta_click', 'valid'),
    event(2, 'recording_start', 'valid'),
    event(3, 'purchase_success', 'payment-only'),
    event(4, 'recording_complete', 'out-of-order'),
    event(5, 'page_view', 'out-of-order'),
  ];

  const result = aggregateAdminAnalytics(rows, { groupBy: 'none' });

  expect(result.funnel.map((step) => step.users)).toEqual([2, 1, 1, 0, 0, 0, 0]);
});

test('filters and groups by campaign without exposing visitor identifiers', () => {
  const shared = { entry_path: '/zh/compare/excalicast-vs-excalicord', content_type: 'compare' };
  const rows = [
    event(0, 'page_view', 'a', { ...shared, utm_campaign: 'launch', source_kind: 'desktop' }),
    event(1, 'comparison_cta_click', 'a', { ...shared, utm_campaign: 'launch', source_kind: 'desktop' }),
    event(2, 'page_view', 'b', { ...shared, utm_campaign: 'evergreen', source_kind: 'whiteboard' }),
  ];

  const result = aggregateAdminAnalytics(rows, {
    groupBy: 'campaign',
    filters: { content_type: 'compare' },
  });

  expect(result.segments.map((segment) => [segment.key, segment.pageViews, segment.ctaClicks])).toEqual([
    ['evergreen', 1, 0],
    ['launch', 1, 1],
  ]);
  expect(JSON.stringify(result.paths)).not.toContain('guest-a');
  expect(JSON.stringify(result.paths)).not.toContain('guest-b');
});

test('aggregates anonymous behavior paths and step duration percentiles', () => {
  const rows: AnalyticsEventRow[] = [];
  [10, 20, 30, 100].forEach((ctaDelay, index) => {
    const session = `s${index}`;
    rows.push(event(index * 1000, 'page_view', session));
    rows.push(event(index * 1000 + ctaDelay, 'content_cta_click', session));
    rows.push(event(index * 1000 + ctaDelay + 10, 'recording_start', session));
  });

  const result = aggregateAdminAnalytics(rows, { groupBy: 'none' });
  const page = result.funnel[0];

  expect(result.paths[0]).toMatchObject({
    steps: ['page_view', 'cta_click', 'recording_start'],
    sessions: 4,
  });
  expect(page.duration).toEqual({ medianMs: 25000, p75Ms: 47500, p90Ms: 79000 });
});

test('uses page-exit time for the final observed drop-off step', () => {
  const rows = [
    event(0, 'page_view', 'left'),
    event(5, 'content_cta_click', 'left'),
    event(45, 'journey_leave', 'left', { duration_ms: 45000 }),
  ];

  const result = aggregateAdminAnalytics(rows, { groupBy: 'none' });

  expect(result.funnel[1].duration).toEqual({ medianMs: 40000, p75Ms: 40000, p90Ms: 40000 });
});

test('accepts page journey events through the analytics whitelist', () => {
  expect(KNOWN_EVENT_SET.has('page_view')).toBe(true);
  expect(KNOWN_EVENT_SET.has('journey_leave')).toBe(true);
});

test('parses bounded date ranges, grouping and dimension filters', () => {
  const query = parseAdminAnalyticsQuery(
    new URL('https://excalicast.cc/api/admin/analytics?from=2026-07-01&to=2026-07-31&groupBy=source_kind&locale=zh&campaign=launch'),
    new Date('2026-08-05T12:00:00.000Z'),
  );

  expect(query).toEqual({
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-31T23:59:59.999Z',
    groupBy: 'source_kind',
    filters: { locale: 'zh', campaign: 'launch' },
  });
});

test('falls back to the last 30 days for invalid date and grouping input', () => {
  const query = parseAdminAnalyticsQuery(
    new URL('https://excalicast.cc/api/admin/analytics?from=nope&to=also-nope&groupBy=user_id'),
    new Date('2026-08-05T12:00:00.000Z'),
  );

  expect(query).toEqual({
    from: '2026-07-06T12:00:00.000Z',
    to: '2026-08-05T12:00:00.000Z',
    groupBy: 'none',
    filters: {},
  });
});

test('uses the public Supabase URL as the server URL fallback', () => {
  expect(resolveAnalyticsServerConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  })).toEqual({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role',
  });
});
