'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';

interface Data {
  range: number;
  capped: boolean;
  summary: { totalEvents: number; uniqueUsers: number; todayEvents: number; last7dEvents: number };
  byEvent: { event: string; count: number }[];
  funnel: { step: string; users: number }[];
  daily: { day: string; count: number }[];
  recent: { event: string; who: string; path: string; at: string }[];
}

const SECRET_KEY = 'excalicast.adminSecret';

export default function AdminAnalyticsPage(): JSX.Element {
  const [secret, setSecret] = useState('');
  const [input, setInput] = useState('');
  const [range, setRange] = useState<number>(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (sec: string, r: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?range=${r}`, { headers: { 'x-admin-secret': sec }, cache: 'no-store' });
      if (res.status === 403) { setError('Wrong admin secret.'); setData(null); setSecret(''); try { sessionStorage.removeItem(SECRET_KEY); } catch { /* */ } return; }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? `HTTP ${res.status}`); return; }
      setData((await res.json()) as Data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let s = '';
    try { s = sessionStorage.getItem(SECRET_KEY) ?? ''; } catch { /* */ }
    if (s) { setSecret(s); void fetchData(s, range); }
  }, [fetchData, range]);

  useEffect(() => {
    if (secret) void fetchData(secret, range);
  }, [range, secret, fetchData]);

  const login = () => {
    const s = input.trim();
    if (!s) return;
    try { sessionStorage.setItem(SECRET_KEY, s); } catch { /* */ }
    setSecret(s);
    void fetchData(s, range);
  };

  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <div style={{ width: 340, background: 'var(--paper)', border: '1.8px solid var(--ink)', borderRadius: 5, boxShadow: '6px 6px 0 var(--ink)', padding: 24 }}>
          <div className="label-mono" style={{ marginBottom: 8 }}>// admin</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Analytics</h1>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login(); }}
            placeholder="ADMIN_SECRET"
            className="mt-4 w-full outline-none"
            style={{ border: '1.5px solid var(--ink)', borderRadius: 3, padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--paper)', color: 'var(--ink)' }}
          />
          <button type="button" className="btn-sketch btn-sketch-primary mt-3 w-full" style={{ justifyContent: 'center' }} onClick={login}>
            {loading ? 'Loading…' : 'Enter'}
          </button>
          {error && <div className="mt-3" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--rec)' }}>{error}</div>}
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.count));
  const maxEvent = Math.max(1, ...data.byEvent.map((e) => e.count));
  const funnelTop = Math.max(1, data.funnel[0]?.users ?? 1);

  return (
    <div className="min-h-screen px-8 py-8" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="mx-auto" style={{ maxWidth: 1100 }}>
        {/* Header */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <div className="label-mono" style={{ marginBottom: 6 }}>// admin · analytics{data.capped ? ' · capped' : ''}</div>
            <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', margin: 0 }}>User analytics</h1>
          </div>
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                style={{
                  padding: '6px 12px', border: '1.4px solid var(--ink)', borderRadius: 999,
                  background: range === r ? 'var(--ink)' : 'var(--paper)', color: range === r ? 'var(--paper)' : 'var(--ink)',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Total events', data.summary.totalEvents],
            ['Unique users', data.summary.uniqueUsers],
            ['Today', data.summary.todayEvents],
            ['Last 7d', data.summary.last7dEvents],
          ].map(([label, val]) => (
            <div key={label as string} style={card}>
              <div className="label-mono" style={{ marginBottom: 6 }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>{(val as number).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Funnel */}
          <div style={card}>
            <h2 style={h2}>Conversion funnel</h2>
            <div className="mt-3 grid gap-2.5">
              {data.funnel.map((f) => {
                const pct = Math.round((f.users / funnelTop) * 100);
                return (
                  <div key={f.step}>
                    <div className="flex items-center justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 3 }}>
                      <span>{f.step}</span>
                      <span style={{ color: 'var(--ink-2)' }}>{f.users.toLocaleString()} · {pct}%</span>
                    </div>
                    <div style={{ height: 14, background: 'var(--paper-2)', border: '1.3px solid var(--ink)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--hi)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily */}
          <div style={card}>
            <h2 style={h2}>Events / day</h2>
            <div className="mt-3 flex items-end gap-[2px]" style={{ height: 140 }}>
              {data.daily.map((d) => (
                <div key={d.day} title={`${d.day} · ${d.count}`} className="flex-1" style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: d.count > 0 ? 2 : 0, background: 'var(--ink)', borderRadius: 1 }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-3)' }}>
              <span>{data.daily[0]?.day}</span>
              <span>{data.daily[data.daily.length - 1]?.day}</span>
            </div>
          </div>

          {/* By event */}
          <div style={card}>
            <h2 style={h2}>Events by type</h2>
            <div className="mt-3 grid gap-1.5">
              {data.byEvent.map((e) => (
                <div key={e.event} className="flex items-center gap-3">
                  <div style={{ width: 150, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.event}</div>
                  <div className="flex-1" style={{ height: 12, background: 'var(--paper-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${(e.count / maxEvent) * 100}%`, height: '100%', background: 'var(--ink)' }} />
                  </div>
                  <div style={{ width: 56, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.count.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent */}
          <div style={card}>
            <h2 style={h2}>Recent events</h2>
            <div className="mt-3 overflow-auto" style={{ maxHeight: 260 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '4px 6px', fontWeight: 600 }}>{r.event}</td>
                      <td style={{ padding: '4px 6px', color: 'var(--ink-3)' }}>{r.who}</td>
                      <td style={{ padding: '4px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{r.path}</td>
                      <td style={{ padding: '4px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--paper)', border: '1.6px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)', padding: 18,
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 };
