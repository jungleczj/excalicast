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

export const CONVERSION_STEPS = [
  'page_view',
  'cta_click',
  'recording_start',
  'recording_complete',
  'export_success',
  'checkout_start',
  'purchase_success',
] as const;

export type ConversionStep = (typeof CONVERSION_STEPS)[number];
export type AnalyticsGroupBy = 'none' | 'locale' | 'entry_path' | 'source_kind' | 'content_type' | 'campaign';
export type AnalyticsDimension = Exclude<AnalyticsGroupBy, 'none'>;
export type AnalyticsFilters = Partial<Record<AnalyticsDimension, string>>;

export interface AdminAnalyticsQuery {
  from: string;
  to: string;
  groupBy: AnalyticsGroupBy;
  filters: AnalyticsFilters;
}

interface DurationPercentiles {
  medianMs: number;
  p75Ms: number;
  p90Ms: number;
}

export interface FunnelStepResult {
  step: ConversionStep;
  users: number;
  conversionRate: number;
  dropoffRate: number;
  duration: DurationPercentiles | null;
}

interface SessionJourney {
  key: string;
  rows: AnalyticsEventRow[];
  dimensions: Record<AnalyticsDimension, string>;
  reached: Array<{ step: ConversionStep; at: number }>;
  leaveAt: number | null;
}

const PAGE_EVENTS = new Set(['page_view', 'organic_landing_view', 'content_page_view', 'comparison_view']);
const CTA_EVENTS = new Set(['cta_start_recording', 'pricing_cta_click', 'content_cta_click', 'comparison_cta_click']);

function toStep(event: string): ConversionStep | null {
  if (PAGE_EVENTS.has(event)) return 'page_view';
  if (CTA_EVENTS.has(event)) return 'cta_click';
  return (CONVERSION_STEPS as readonly string[]).includes(event) ? event as ConversionStep : null;
}

function textProp(row: AnalyticsEventRow, key: string): string {
  const value = row.props?.[key];
  return typeof value === 'string' ? value : '';
}

function sessionKey(row: AnalyticsEventRow): string | null {
  if (row.session_id) return `session:${row.session_id}`;
  if (row.user_id) return `user:${row.user_id}`;
  if (row.guest_id) return `guest:${row.guest_id}`;
  return null;
}

function roundRate(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const interpolated = sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return Math.round(interpolated);
}

function durationSummary(values: number[]): DurationPercentiles | null {
  if (values.length === 0) return null;
  return {
    medianMs: percentile(values, 0.5),
    p75Ms: percentile(values, 0.75),
    p90Ms: percentile(values, 0.9),
  };
}

function parseDateOnly(value: string | null, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const date = new Date(`${value}${suffix}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseAdminAnalyticsQuery(url: URL, now = new Date()): AdminAnalyticsQuery {
  const requestedFrom = parseDateOnly(url.searchParams.get('from'), false);
  const requestedTo = parseDateOnly(url.searchParams.get('to'), true);
  const validExplicitRange = requestedFrom && requestedTo
    && requestedFrom.getTime() <= requestedTo.getTime()
    && requestedTo.getTime() - requestedFrom.getTime() <= 366 * 86400_000;

  const rangeParam = Number(url.searchParams.get('range'));
  const rangeDays = [7, 30, 90].includes(rangeParam) ? rangeParam : 30;
  const to = validExplicitRange ? requestedTo : now;
  const from = validExplicitRange ? requestedFrom : new Date(now.getTime() - rangeDays * 86400_000);

  const rawGroup = url.searchParams.get('groupBy') ?? 'none';
  const groupBy = (['none', 'locale', 'entry_path', 'source_kind', 'content_type', 'campaign'] as const)
    .includes(rawGroup as AnalyticsGroupBy)
    ? rawGroup as AnalyticsGroupBy
    : 'none';
  const filters: AnalyticsFilters = {};
  for (const dimension of ['locale', 'entry_path', 'source_kind', 'content_type', 'campaign'] as const) {
    const value = url.searchParams.get(dimension)?.trim().slice(0, 200);
    if (value) filters[dimension] = value;
  }

  return { from: from.toISOString(), to: to.toISOString(), groupBy, filters };
}

function buildJourneys(rows: AnalyticsEventRow[]): SessionJourney[] {
  const sessions = new Map<string, AnalyticsEventRow[]>();
  for (const row of rows) {
    const key = sessionKey(row);
    if (!key) continue;
    const bucket = sessions.get(key) ?? [];
    bucket.push(row);
    sessions.set(key, bucket);
  }

  return Array.from(sessions, ([key, unsorted]) => {
    const ordered = [...unsorted].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const dimensions: Record<AnalyticsDimension, string> = {
      locale: '',
      entry_path: '',
      source_kind: '',
      content_type: '',
      campaign: '',
    };
    for (const row of ordered) {
      dimensions.locale ||= row.locale ?? textProp(row, 'locale');
      dimensions.entry_path ||= textProp(row, 'entry_path') || row.path || '';
      dimensions.source_kind ||= textProp(row, 'source_kind');
      dimensions.content_type ||= textProp(row, 'content_type');
      dimensions.campaign ||= textProp(row, 'utm_campaign');
    }

    const reached: SessionJourney['reached'] = [];
    let expectedIndex = 0;
    for (const row of ordered) {
      const step = toStep(row.event);
      if (!step) continue;
      const expected = CONVERSION_STEPS[expectedIndex];
      if (step === expected) {
        reached.push({ step, at: new Date(row.created_at).getTime() });
        expectedIndex++;
      }
    }

    const leave = [...ordered].reverse().find((row) => row.event === 'journey_leave');
    const leaveAt = leave ? new Date(leave.created_at).getTime() : null;
    return { key, rows: ordered, dimensions, reached, leaveAt };
  });
}

function matchesFilters(journey: SessionJourney, filters: AnalyticsFilters): boolean {
  return Object.entries(filters).every(([dimension, expected]) => (
    !expected || journey.dimensions[dimension as AnalyticsDimension] === expected
  ));
}

function summarizeJourneys(journeys: SessionJourney[]): {
  summary: { sessions: number; pageViews: number; ctaClicks: number; ctr: number; paid: number };
  funnel: FunnelStepResult[];
} {
  const counts = CONVERSION_STEPS.map((_, index) => journeys.filter((journey) => journey.reached.length > index).length);
  const durations = CONVERSION_STEPS.map(() => [] as number[]);

  for (const journey of journeys) {
    journey.reached.forEach((current, index) => {
      const nextAt = journey.reached[index + 1]?.at ?? journey.leaveAt;
      if (nextAt !== null && nextAt >= current.at) durations[index].push(nextAt - current.at);
    });
  }

  const top = counts[0] || 0;
  const funnel = CONVERSION_STEPS.map((step, index): FunnelStepResult => {
    const users = counts[index];
    const next = counts[index + 1];
    return {
      step,
      users,
      conversionRate: top ? roundRate((users / top) * 100) : 0,
      dropoffRate: index === CONVERSION_STEPS.length - 1 || users === 0
        ? 0
        : roundRate(((users - next) / users) * 100),
      duration: durationSummary(durations[index]),
    };
  });

  return {
    summary: {
      sessions: journeys.length,
      pageViews: counts[0],
      ctaClicks: counts[1],
      ctr: counts[0] ? roundRate((counts[1] / counts[0]) * 100) : 0,
      paid: counts[CONVERSION_STEPS.length - 1],
    },
    funnel,
  };
}

export function aggregateAdminAnalytics(
  rows: AnalyticsEventRow[],
  options: { groupBy: AnalyticsGroupBy; filters?: AnalyticsFilters },
) {
  const allJourneys = buildJourneys(rows);
  const journeys = allJourneys.filter((journey) => matchesFilters(journey, options.filters ?? {}));
  const core = summarizeJourneys(journeys);

  const pathMap = new Map<string, { steps: ConversionStep[]; sessions: number; paid: number; totalDurationMs: number[] }>();
  for (const journey of journeys) {
    if (journey.reached.length === 0) continue;
    const steps = journey.reached.map((item) => item.step);
    const key = steps.join('>');
    const bucket = pathMap.get(key) ?? { steps, sessions: 0, paid: 0, totalDurationMs: [] };
    bucket.sessions++;
    if (steps.at(-1) === 'purchase_success') bucket.paid++;
    const start = journey.reached[0]?.at;
    const end = journey.reached.at(-1)?.at;
    if (start !== undefined && end !== undefined && end >= start) bucket.totalDurationMs.push(end - start);
    pathMap.set(key, bucket);
  }
  const paths = Array.from(pathMap.values())
    .map((path) => ({
      steps: path.steps,
      sessions: path.sessions,
      paidConversionRate: roundRate((path.paid / path.sessions) * 100),
      medianJourneyMs: percentile(path.totalDurationMs, 0.5),
    }))
    .sort((a, b) => b.sessions - a.sessions || a.steps.join('>').localeCompare(b.steps.join('>')))
    .slice(0, 20);

  const segmentMap = new Map<string, SessionJourney[]>();
  if (options.groupBy !== 'none') {
    for (const journey of journeys) {
      const key = journey.dimensions[options.groupBy] || '(not set)';
      const bucket = segmentMap.get(key) ?? [];
      bucket.push(journey);
      segmentMap.set(key, bucket);
    }
  }
  const segments = Array.from(segmentMap, ([key, segmentJourneys]) => {
    const result = summarizeJourneys(segmentJourneys);
    return { key, ...result.summary, funnel: result.funnel };
  }).sort((a, b) => a.key.localeCompare(b.key));

  const dimensions = (['locale', 'entry_path', 'source_kind', 'content_type', 'campaign'] as const)
    .reduce<Record<AnalyticsDimension, string[]>>((result, dimension) => {
      result[dimension] = Array.from(new Set(allJourneys.map((journey) => journey.dimensions[dimension]).filter(Boolean))).sort();
      return result;
    }, { locale: [], entry_path: [], source_kind: [], content_type: [], campaign: [] });

  return { ...core, paths, segments, dimensions };
}
