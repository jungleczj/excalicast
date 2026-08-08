import { expect, test } from '@playwright/test';
import {
  buildAdminAnalyticsDashboard,
  sanitizeAnalyticsProps,
  type AnalyticsEventRow,
} from '@/lib/analytics/admin';

const rows: AnalyticsEventRow[] = [
  {
    event: 'content_cta_click',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/use-cases/record',
    locale: 'en',
    props: {
      entry_path: '/en/use-cases/record',
      content_type: 'use-case',
      slug: 'record',
      source_kind: 'whiteboard',
      traffic_kind: 'organic',
    },
    created_at: '2026-08-01T10:00:00.000Z',
  },
  {
    event: 'recording_start',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/app',
    locale: 'en',
    props: { source: 'whiteboard' },
    created_at: '2026-08-01T10:01:00.000Z',
  },
  {
    event: 'recording_complete',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/app',
    locale: 'en',
    props: { source_kind: 'whiteboard' },
    created_at: '2026-08-01T10:04:00.000Z',
  },
  {
    event: 'export_success',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/export/rec_a',
    locale: 'en',
    props: { source_kind: 'whiteboard' },
    created_at: '2026-08-01T10:06:00.000Z',
  },
  {
    event: 'checkout_start',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/export/rec_a',
    locale: 'en',
    props: { kind: 'one_time', payment_provider: 'paddle' },
    created_at: '2026-08-01T10:08:00.000Z',
  },
  {
    event: 'purchase_success',
    user_id: null,
    guest_id: 'guest_a',
    session_id: 'session_a',
    path: '/en/export/rec_a',
    locale: 'en',
    props: { kind: 'one_time', payment_provider: 'paddle' },
    created_at: '2026-08-01T10:09:00.000Z',
  },
  {
    event: 'content_cta_click',
    user_id: null,
    guest_id: 'guest_b',
    session_id: 'session_b',
    path: '/zh/blog/example',
    locale: 'zh-CN',
    props: {
      entry_path: '/zh/blog/example',
      content_type: 'blog',
      slug: 'example',
      source_kind: 'screen',
      traffic_kind: 'direct',
    },
    created_at: '2026-08-01T11:00:00.000Z',
  },
  {
    event: 'recording_start',
    user_id: null,
    guest_id: 'guest_b',
    session_id: 'session_b',
    path: '/zh/app',
    locale: 'zh-CN',
    props: { source: 'screen' },
    created_at: '2026-08-01T11:05:00.000Z',
  },
];

test.describe('admin analytics dashboard domain', () => {
  test('builds a conversion funnel with dropoff and dwell time under selected dimensions', () => {
    const dashboard = buildAdminAnalyticsDashboard(rows, {
      now: new Date('2026-08-05T00:00:00.000Z'),
      rangeDays: 30,
      filters: {
        locale: 'en',
        entryPath: '/en/use-cases/record',
        contentType: 'use-case',
        sourceKind: 'whiteboard',
        paymentProvider: 'paddle',
      },
    });

    expect(dashboard.summary).toMatchObject({
      totalEvents: 6,
      uniqueUsers: 1,
    });
    expect(dashboard.activeFilters).toEqual({
      locale: 'en',
      entryPath: '/en/use-cases/record',
      contentType: 'use-case',
      sourceKind: 'whiteboard',
      paymentProvider: 'paddle',
    });
    expect(dashboard.funnel.map((step) => ({
      step: step.step,
      users: step.users,
      conversionRate: step.conversionRate,
      dropoffUsers: step.dropoffUsers,
      medianDwellSecondsFromPrevious: step.medianDwellSecondsFromPrevious,
    }))).toEqual([
      { step: 'content_cta_click', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: null },
      { step: 'recording_start', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: 60 },
      { step: 'recording_complete', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: 180 },
      { step: 'export_success', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: 120 },
      { step: 'checkout_start', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: 120 },
      { step: 'purchase_success', users: 1, conversionRate: 1, dropoffUsers: 0, medianDwellSecondsFromPrevious: 60 },
    ]);
    expect(dashboard.dimensionOptions.locale).toEqual(['en', 'zh-CN']);
    expect(dashboard.dimensionOptions.paymentProvider).toEqual(['paddle']);
  });

  test('drops sensitive analytics props before storage', () => {
    expect(sanitizeAnalyticsProps({
      q: 'private search',
      query: 'customer@example.com',
      media_url: 'https://example.test/video.mp4',
      transcript: 'spoken words',
      source_kind: 'screen',
      durationMs: 1250,
      hasAudio: true,
    })).toEqual({
      source_kind: 'screen',
      durationMs: 1250,
      hasAudio: true,
    });
  });
});
