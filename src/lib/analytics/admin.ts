import { KNOWN_EVENTS, type KnownEvent } from './events';

export interface AnalyticsEventRow {
  event: string;
  user_id: string | null;
  guest_id: string | null;
  session_id: string | null;
  path: string | null;
  locale: string | null;
  props: Record<string, string | number | boolean> | null;
  created_at: string;
}

export interface AdminAnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  locale?: string;
  entryPath?: string;
  contentType?: string;
  sourceKind?: string;
  paymentProvider?: string;
}

export interface AdminAnalyticsOptions {
  now?: Date;
  rangeDays: number;
  filters?: AdminAnalyticsFilters;
  capped?: boolean;
}

export interface AdminAnalyticsDashboard {
  range: number;
  capped: boolean;
  activeFilters: AdminAnalyticsFilters;
  summary: {
    totalEvents: number;
    uniqueUsers: number;
    todayEvents: number;
    last7dEvents: number;
    exposures: number;
    ctaClicks: number;
    clickThroughRate: number;
  };
  byEvent: { event: string; count: number }[];
  funnel: {
    step: KnownEvent;
    users: number;
    conversionRate: number;
    overallConversionRate: number;
    dropoffUsers: number;
    medianDwellSecondsFromPrevious: number | null;
  }[];
  daily: { day: string; count: number }[];
  recent: { event: string; who: string; path: string; at: string }[];
  acquisition: {
    entryPath: string;
    contentType: string;
    slug: string;
    locale: string;
    sourceKind: string;
    trafficKind: string;
    paymentProvider: string;
    sessions: number;
    exposures: number;
    ctaClicks: number;
    clickThroughRate: number;
    recordingStarts: number;
    recordingCompletes: number;
    exports: number;
    checkoutStarts: number;
    purchases: number;
  }[];
  dimensionOptions: {
    locale: string[];
    entryPath: string[];
    contentType: string[];
    sourceKind: string[];
    paymentProvider: string[];
  };
}

const ADMIN_FUNNEL_STEPS: KnownEvent[] = [
  'content_cta_click',
  'recording_start',
  'recording_complete',
  'export_success',
  'checkout_start',
  'purchase_success',
];

const EXPOSURE_EVENTS = new Set<string>([
  'organic_landing_view',
  'content_page_view',
  'comparison_view',
]);

const CTA_EVENTS = new Set<string>([
  'cta_start_recording',
  'pricing_cta_click',
  'content_cta_click',
  'comparison_cta_click',
]);

const BLOCKED_PROP_KEYS = new Set([
  'q',
  'query',
  'search',
  'search_term',
  'search_terms',
  'keyword',
  'keywords',
  'prompt',
  'email',
  'phone',
  'name',
  'media_url',
  'audio_url',
  'video_url',
  'file_url',
  'recording_id',
  'recordingid',
  'token',
  'secret',
  'transcript',
  'media_content',
  'subtitle_text',
  'srt',
]);

const BLOCKED_PROP_PATTERNS = [
  /transcript/,
  /search.*term/,
  /media.*content/,
  /(media|audio|video|file).*url/,
  /(access|auth|refresh).*token/,
];

export function sanitizeAnalyticsProps(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input).slice(0, 24)) {
    const normalizedKey = key.replace(/[-\s]/g, '_').toLowerCase();
    if (BLOCKED_PROP_KEYS.has(normalizedKey)) continue;
    if (BLOCKED_PROP_PATTERNS.some((pattern) => pattern.test(normalizedKey))) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) props[key] = trimmed.slice(0, 200);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      props[key] = value;
    } else if (typeof value === 'boolean') {
      props[key] = value;
    }
  }
  return props;
}

export function buildAdminAnalyticsDashboard(
  rows: AnalyticsEventRow[],
  options: AdminAnalyticsOptions,
): AdminAnalyticsDashboard {
  const now = options.now ?? new Date();
  const rangeDays = options.rangeDays;
  const since = startDate(options.filters?.dateFrom, now, rangeDays);
  const until = endDate(options.filters?.dateTo, now);
  const profiles = buildProfiles(rows);
  const activeFilters = compactFilters(options.filters ?? {});
  const rangedRows = rows.filter((row) => {
    const time = Date.parse(row.created_at);
    return Number.isFinite(time) && time >= since.getTime() && time <= until.getTime();
  });
  const dimensionOptions = buildDimensionOptions(rangedRows, profiles);
  const filteredRows = rangedRows.filter((row) => rowMatchesFilters(row, profiles, activeFilters));
  const users = uniqueUsers(filteredRows);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const sevenAgo = now.getTime() - 7 * 86400_000;
  const todayEvents = filteredRows.filter((row) => Date.parse(row.created_at) >= startOfToday.getTime()).length;
  const last7dEvents = filteredRows.filter((row) => Date.parse(row.created_at) >= sevenAgo).length;
  const exposures = filteredRows.filter((row) => EXPOSURE_EVENTS.has(row.event)).length;
  const ctaClicks = filteredRows.filter((row) => CTA_EVENTS.has(row.event)).length;

  return {
    range: rangeDays,
    capped: Boolean(options.capped),
    activeFilters,
    summary: {
      totalEvents: filteredRows.length,
      uniqueUsers: users.size,
      todayEvents,
      last7dEvents,
      exposures,
      ctaClicks,
      clickThroughRate: ratio(ctaClicks, exposures),
    },
    byEvent: byEvent(filteredRows),
    funnel: buildFunnel(filteredRows),
    daily: daily(filteredRows, since, until),
    recent: recent(filteredRows),
    acquisition: acquisition(filteredRows, profiles),
    dimensionOptions,
  };
}

function startDate(dateFrom: string | undefined, now: Date, rangeDays: number): Date {
  if (dateFrom) {
    const parsed = new Date(`${dateFrom}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date(now.getTime() - rangeDays * 86400_000);
}

function endDate(dateTo: string | undefined, now: Date): Date {
  if (dateTo) {
    const parsed = new Date(`${dateTo}T23:59:59.999Z`);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return now;
}

function compactFilters(filters: AdminAnalyticsFilters): AdminAnalyticsFilters {
  const out: AdminAnalyticsFilters = {};
  for (const key of ['dateFrom', 'dateTo', 'locale', 'entryPath', 'contentType', 'sourceKind', 'paymentProvider'] as const) {
    const value = filters[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

function identity(row: AnalyticsEventRow): string | null {
  return row.user_id ? `u:${row.user_id}` : row.guest_id ? `g:${row.guest_id}` : row.session_id ? `s:${row.session_id}` : null;
}

function sessionKey(row: AnalyticsEventRow): string | null {
  return row.session_id ?? identity(row);
}

function prop(row: AnalyticsEventRow, key: string): string {
  const value = row.props?.[key];
  return typeof value === 'string' ? value : '';
}

function sourceKind(row: AnalyticsEventRow): string {
  return prop(row, 'source_kind') || prop(row, 'source');
}

function paymentProvider(row: AnalyticsEventRow): string {
  return prop(row, 'payment_provider') || prop(row, 'provider');
}

interface Profile {
  entryPath: string;
  contentType: string;
  slug: string;
  locale: string;
  sourceKind: string;
  trafficKind: string;
  paymentProvider: string;
}

function buildProfiles(rows: AnalyticsEventRow[]): Map<string, Profile> {
  const profiles = new Map<string, Profile>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const key = sessionKey(row);
    if (!key) continue;
    const current = profiles.get(key) ?? {
      entryPath: '',
      contentType: '',
      slug: '',
      locale: '',
      sourceKind: '',
      trafficKind: '',
      paymentProvider: '',
    };
    profiles.set(key, {
      entryPath: current.entryPath || prop(row, 'entry_path') || row.path || '',
      contentType: current.contentType || prop(row, 'content_type'),
      slug: current.slug || prop(row, 'slug'),
      locale: current.locale || row.locale || '',
      sourceKind: current.sourceKind || sourceKind(row),
      trafficKind: current.trafficKind || prop(row, 'traffic_kind'),
      paymentProvider: current.paymentProvider || paymentProvider(row),
    });
  }
  return profiles;
}

function profileFor(row: AnalyticsEventRow, profiles: Map<string, Profile>): Profile {
  const blank = { entryPath: '', contentType: '', slug: '', locale: '', sourceKind: '', trafficKind: '', paymentProvider: '' };
  return (sessionKey(row) ? profiles.get(sessionKey(row)!) : null) ?? blank;
}

function rowMatchesFilters(
  row: AnalyticsEventRow,
  profiles: Map<string, Profile>,
  filters: AdminAnalyticsFilters,
): boolean {
  const profile = profileFor(row, profiles);
  if (filters.locale && profile.locale !== filters.locale) return false;
  if (filters.entryPath && profile.entryPath !== filters.entryPath) return false;
  if (filters.contentType && profile.contentType !== filters.contentType) return false;
  if (filters.sourceKind && profile.sourceKind !== filters.sourceKind) return false;
  if (filters.paymentProvider && profile.paymentProvider !== filters.paymentProvider) return false;
  return true;
}

function uniqueUsers(rows: AnalyticsEventRow[]): Set<string> {
  const users = new Set<string>();
  for (const row of rows) {
    const id = identity(row);
    if (id) users.add(id);
  }
  return users;
}

function byEvent(rows: AnalyticsEventRow[]): { event: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.event, (counts.get(row.event) ?? 0) + 1);
  return [...counts.entries()].map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count);
}

function buildFunnel(rows: AnalyticsEventRow[]): AdminAnalyticsDashboard['funnel'] {
  const subjectSteps = new Map<string, Map<KnownEvent, number>>();
  for (const row of rows) {
    if (!KNOWN_EVENTS.includes(row.event as KnownEvent)) continue;
    const step = row.event as KnownEvent;
    if (!ADMIN_FUNNEL_STEPS.includes(step)) continue;
    const id = identity(row);
    if (!id) continue;
    const time = Date.parse(row.created_at);
    const steps = subjectSteps.get(id) ?? new Map<KnownEvent, number>();
    steps.set(step, Math.min(steps.get(step) ?? Number.POSITIVE_INFINITY, time));
    subjectSteps.set(id, steps);
  }

  let previousUsers = 0;
  const firstUsers = countUsersWithStep(subjectSteps, ADMIN_FUNNEL_STEPS[0]);
  return ADMIN_FUNNEL_STEPS.map((step, index) => {
    const users = countUsersWithStep(subjectSteps, step);
    const dwell = index === 0 ? null : medianDwell(subjectSteps, ADMIN_FUNNEL_STEPS[index - 1], step);
    const conversionBase = index === 0 ? users : previousUsers;
    const result = {
      step,
      users,
      conversionRate: index === 0 ? 1 : ratio(users, conversionBase),
      overallConversionRate: index === 0 ? 1 : ratio(users, firstUsers),
      dropoffUsers: index === 0 ? 0 : Math.max(0, previousUsers - users),
      medianDwellSecondsFromPrevious: dwell,
    };
    previousUsers = users;
    return result;
  });
}

function countUsersWithStep(subjectSteps: Map<string, Map<KnownEvent, number>>, step: KnownEvent): number {
  let count = 0;
  for (const steps of subjectSteps.values()) {
    if (steps.has(step)) count++;
  }
  return count;
}

function medianDwell(
  subjectSteps: Map<string, Map<KnownEvent, number>>,
  previous: KnownEvent,
  current: KnownEvent,
): number | null {
  const values: number[] = [];
  for (const steps of subjectSteps.values()) {
    const a = steps.get(previous);
    const b = steps.get(current);
    if (a === undefined || b === undefined || b < a) continue;
    values.push(Math.round((b - a) / 1000));
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? Math.round((values[mid - 1] + values[mid]) / 2) : values[mid];
}

function daily(rows: AnalyticsEventRow[], since: Date, until: Date): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days: { day: string; count: number }[] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()));
  while (cursor <= end && days.length < 370) {
    const day = cursor.toISOString().slice(0, 10);
    days.push({ day, count: counts.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function recent(rows: AnalyticsEventRow[]): AdminAnalyticsDashboard['recent'] {
  return [...rows]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 50)
    .map((row) => ({
      event: row.event,
      who: row.user_id ? `u:${row.user_id.slice(0, 8)}` : row.guest_id ? `g:${row.guest_id.slice(0, 8)}` : 'anon',
      path: row.path ?? '',
      at: row.created_at,
    }));
}

function acquisition(
  rows: AnalyticsEventRow[],
  profiles: Map<string, Profile>,
): AdminAnalyticsDashboard['acquisition'] {
  const sessions = new Map<string, { profile: Profile; events: Set<string> }>();
  for (const row of rows) {
    const key = sessionKey(row);
    if (!key) continue;
    const item = sessions.get(key) ?? { profile: profileFor(row, profiles), events: new Set<string>() };
    item.events.add(row.event);
    sessions.set(key, item);
  }

  const buckets = new Map<string, AdminAnalyticsDashboard['acquisition'][number]>();
  for (const { profile, events } of sessions.values()) {
    const key = [
      profile.entryPath,
      profile.contentType,
      profile.slug,
      profile.locale,
      profile.sourceKind,
      profile.trafficKind,
      profile.paymentProvider,
    ].join('\u0000');
    const bucket = buckets.get(key) ?? {
      ...profile,
      sessions: 0,
      exposures: 0,
      ctaClicks: 0,
      clickThroughRate: 0,
      recordingStarts: 0,
      recordingCompletes: 0,
      exports: 0,
      checkoutStarts: 0,
      purchases: 0,
    };
    bucket.sessions++;
    if ([...events].some((event) => EXPOSURE_EVENTS.has(event))) bucket.exposures++;
    if ([...events].some((event) => CTA_EVENTS.has(event))) bucket.ctaClicks++;
    if (events.has('recording_start')) bucket.recordingStarts++;
    if (events.has('recording_complete')) bucket.recordingCompletes++;
    if (events.has('export_success')) bucket.exports++;
    if (events.has('checkout_start')) bucket.checkoutStarts++;
    if (events.has('purchase_success')) bucket.purchases++;
    bucket.clickThroughRate = ratio(bucket.ctaClicks, bucket.exposures);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.sessions - a.sessions);
}

function buildDimensionOptions(
  rows: AnalyticsEventRow[],
  profiles: Map<string, Profile>,
): AdminAnalyticsDashboard['dimensionOptions'] {
  const options = {
    locale: new Set<string>(),
    entryPath: new Set<string>(),
    contentType: new Set<string>(),
    sourceKind: new Set<string>(),
    paymentProvider: new Set<string>(),
  };
  for (const row of rows) {
    const profile = profileFor(row, profiles);
    if (profile.locale) options.locale.add(profile.locale);
    if (profile.entryPath) options.entryPath.add(profile.entryPath);
    if (profile.contentType) options.contentType.add(profile.contentType);
    if (profile.sourceKind) options.sourceKind.add(profile.sourceKind);
    if (profile.paymentProvider) options.paymentProvider.add(profile.paymentProvider);
  }
  return {
    locale: sorted(options.locale),
    entryPath: sorted(options.entryPath),
    contentType: sorted(options.contentType),
    sourceKind: sorted(options.sourceKind),
    paymentProvider: sorted(options.paymentProvider),
  };
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}
