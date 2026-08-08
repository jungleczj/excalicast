'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminAnalyticsQuery,
  AnalyticsDimension,
  AnalyticsFilters,
  AnalyticsGroupBy,
  ConversionStep,
  FunnelStepResult,
} from '@/lib/analytics/adminAggregation';
import styles from './AdminAnalyticsDashboard.module.css';

interface DashboardData {
  query: AdminAnalyticsQuery;
  capped: boolean;
  paymentCoverage: 'client_confirmed';
  summary: { sessions: number; pageViews: number; ctaClicks: number; ctr: number; paid: number };
  funnel: FunnelStepResult[];
  paths: Array<{ steps: ConversionStep[]; sessions: number; paidConversionRate: number; medianJourneyMs: number }>;
  segments: Array<{
    key: string;
    sessions: number;
    pageViews: number;
    ctaClicks: number;
    ctr: number;
    paid: number;
    funnel: FunnelStepResult[];
  }>;
  dimensions: Record<AnalyticsDimension, string[]>;
}

const SECRET_KEY = 'excalicast.adminSecret';
const STEP_LABELS: Record<ConversionStep, string> = {
  page_view: 'Page view',
  cta_click: 'CTA click',
  recording_start: 'Recording started',
  recording_complete: 'Recording completed',
  export_success: 'Export completed',
  checkout_start: 'Checkout opened',
  purchase_success: 'Payment confirmed',
};
const DIMENSION_LABELS: Record<AnalyticsDimension, string> = {
  locale: 'Locale',
  entry_path: 'Entry path',
  source_kind: 'Recording source',
  content_type: 'Content type',
  campaign: 'Campaign',
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function initialDates(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400_000);
  return { from: isoDate(from), to: isoDate(to) };
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function duration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function SecretGate({ loading, error, onSubmit }: {
  loading: boolean;
  error: string | null;
  onSubmit: (secret: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <main className={styles.gate}>
      <form className={styles.gatePanel} onSubmit={(event) => { event.preventDefault(); onSubmit(value.trim()); }}>
        <p className={styles.eyebrow}>ADMIN ACCESS</p>
        <h1>Conversion analytics</h1>
        <label htmlFor="admin-secret">Administrator secret</label>
        <input id="admin-secret" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="ADMIN_SECRET" autoComplete="current-password" />
        <button type="submit" disabled={!value.trim() || loading}>{loading ? 'Verifying…' : 'Enter'}</button>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </form>
    </main>
  );
}

export function AdminAnalyticsDashboard(): JSX.Element {
  const dates = useMemo(initialDates, []);
  const [secret, setSecret] = useState('');
  const [from, setFrom] = useState(dates.from);
  const [to, setTo] = useState(dates.to);
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>('none');
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (adminSecret: string) => {
    if (!adminSecret) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to, groupBy });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    try {
      const response = await fetch(`/api/admin/analytics?${params}`, {
        headers: { 'x-admin-secret': adminSecret },
        cache: 'no-store',
      });
      if (response.status === 403) {
        sessionStorage.removeItem(SECRET_KEY);
        setSecret('');
        setData(null);
        throw new Error('Administrator authorization failed.');
      }
      const body = await response.json().catch(() => ({})) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Analytics request failed.');
    } finally {
      setLoading(false);
    }
  }, [filters, from, groupBy, to]);

  useEffect(() => {
    const saved = sessionStorage.getItem(SECRET_KEY) ?? '';
    if (!saved) return;
    setSecret(saved);
    void load(saved);
  }, []); // The saved credential is restored only once; filters are applied explicitly.

  const login = (candidate: string) => {
    if (!candidate) return;
    sessionStorage.setItem(SECRET_KEY, candidate);
    setSecret(candidate);
    void load(candidate);
  };
  const updateFilter = (dimension: AnalyticsDimension, value: string) => {
    setFilters((current) => ({ ...current, [dimension]: value || undefined }));
  };

  if (!secret || (!data && !loading)) return <SecretGate loading={loading} error={error} onSubmit={login} />;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMIN / ACQUISITION</p>
          <h1>Conversion analytics</h1>
          <p>Aggregated session journeys from entry page to client-confirmed payment.</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void load(secret)} disabled={loading}>Refresh</button>
      </header>

      <section className={styles.filters} aria-label="Analytics filters">
        <label>From<input aria-label="From" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input aria-label="To" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Group by<select aria-label="Group by" value={groupBy} onChange={(event) => setGroupBy(event.target.value as AnalyticsGroupBy)}>
          <option value="none">No grouping</option>
          {Object.entries(DIMENSION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {(Object.keys(DIMENSION_LABELS) as AnalyticsDimension[]).map((dimension) => (
          <label key={dimension}>{DIMENSION_LABELS[dimension]}
            <select aria-label={DIMENSION_LABELS[dimension]} value={filters[dimension] ?? ''} onChange={(event) => updateFilter(dimension, event.target.value)}>
              <option value="">All</option>
              {(data?.dimensions[dimension] ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className={styles.primaryButton} onClick={() => void load(secret)} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
      </section>

      {error && <section className={styles.errorBand} role="alert"><strong>Could not load analytics.</strong><span>{error}</span><button type="button" onClick={() => void load(secret)}>Retry</button></section>}
      {loading && !data && <section className={styles.loading} role="status">Loading conversion data…</section>}

      {data && (
        <>
          <section className={styles.metricStrip} aria-label="Conversion summary">
            <div data-testid="metric-ctr"><span>CTA click-through rate</span><strong>{percent(data.summary.ctr)}</strong><small>{data.summary.ctaClicks} of {data.summary.pageViews} sessions</small></div>
            <div><span>Observed sessions</span><strong>{data.summary.sessions.toLocaleString()}</strong><small>After active filters</small></div>
            <div><span>Recordings started</span><strong>{(data.funnel.find((step) => step.step === 'recording_start')?.users ?? 0).toLocaleString()}</strong><small>Sequential funnel</small></div>
            <div><span>Payments</span><strong>{data.summary.paid.toLocaleString()}</strong><small>Client-confirmed payments</small></div>
          </section>

          {data.summary.pageViews === 0 ? (
            <section className={styles.empty} role="status"><h2>No conversion data</h2><p>No sessions match this date range and filter set.</p></section>
          ) : (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>FUNNEL</p><h2>Entry to payment</h2></div><p>Durations use observed transitions; P50 is the median.</p></div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>Step</th><th>People</th><th>Overall conversion</th><th>Drop-off to next</th><th>P50</th><th>P75</th><th>P90</th></tr></thead>
                    <tbody>{data.funnel.map((step) => (
                      <tr key={step.step}>
                        <th scope="row">{STEP_LABELS[step.step]}</th>
                        <td>{step.users.toLocaleString()}</td><td>{percent(step.conversionRate)}</td><td>{percent(step.dropoffRate)}</td>
                        <td>{duration(step.duration?.medianMs)}</td><td>{duration(step.duration?.p75Ms)}</td><td>{duration(step.duration?.p90Ms)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>PATHS</p><h2>Aggregate behavior paths</h2></div><p>Only grouped sequences are shown; visitor identifiers are never returned.</p></div>
                <div className={styles.tableWrap}>
                  <table><thead><tr><th>Observed path</th><th>Sessions</th><th>Paid</th><th>Median journey</th></tr></thead>
                    <tbody>{data.paths.map((path) => (
                      <tr key={path.steps.join('>')}><th scope="row" className={styles.path}>{path.steps.map((step) => STEP_LABELS[step]).join(' → ')}</th><td>{path.sessions}</td><td>{percent(path.paidConversionRate)}</td><td>{duration(path.medianJourneyMs)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              {groupBy !== 'none' && <section className={styles.section}>
                <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SEGMENTS</p><h2>Grouped by {DIMENSION_LABELS[groupBy]}</h2></div></div>
                <div className={styles.tableWrap}><table><thead><tr><th>{DIMENSION_LABELS[groupBy]}</th><th>Sessions</th><th>Page views</th><th>CTA clicks</th><th>CTR</th><th>Started</th><th>Completed</th><th>Exported</th><th>Checkout</th><th>Paid</th></tr></thead>
                  <tbody>{data.segments.map((segment) => {
                    const usersAt = (step: ConversionStep) => segment.funnel.find((item) => item.step === step)?.users ?? 0;
                    return <tr key={segment.key}><th scope="row">{segment.key}</th><td>{segment.sessions}</td><td>{segment.pageViews}</td><td>{segment.ctaClicks}</td><td>{percent(segment.ctr)}</td><td>{usersAt('recording_start')}</td><td>{usersAt('recording_complete')}</td><td>{usersAt('export_success')}</td><td>{usersAt('checkout_start')}</td><td>{segment.paid}</td></tr>;
                  })}</tbody>
                </table></div>
              </section>}
            </>
          )}
          <footer className={styles.footnote}>{data.capped ? 'Result reached the 50,000-event safety cap. Narrow the date range.' : 'All values are computed from recorded events; missing events are not estimated.'}</footer>
        </>
      )}
    </main>
  );
}
