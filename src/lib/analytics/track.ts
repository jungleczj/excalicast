'use client';

import { track } from '@vercel/analytics';
import { recordingLifecycle } from '@/services/recordingLifecycleSingleton';
import { recordingResourceGate } from '@/services/recordingResourceGate';
import { getOrCreateGuestId } from '@/lib/ownerKey';
import type { KnownEvent } from './events';

type Props = Record<string, string | number | boolean>;
type AttributionProps = Record<string, string>;

const ATTRIBUTION_KEY = 'excalicast.attribution';
const ORGANIC_HOSTS = [
  'google.',
  'bing.',
  'baidu.',
  'sogou.',
  'so.com',
  'duckduckgo.',
  'yahoo.',
  'yandex.',
  'brave.',
  'perplexity.',
  'chatgpt.',
];

function sessionId(): string {
  try {
    let s = sessionStorage.getItem('excalicast.sid');
    if (!s) {
      s = crypto.randomUUID();
      sessionStorage.setItem('excalicast.sid', s);
    }
    return s;
  } catch {
    return 'nosession';
  }
}

function safeGuestId(): string | undefined {
  try { return getOrCreateGuestId(); } catch { return undefined; }
}

function safeHost(value: string): string {
  if (!value) return '';
  try { return new URL(value).hostname.toLowerCase().slice(0, 120); } catch { return ''; }
}

export function sessionAttribution(): AttributionProps {
  if (typeof window === 'undefined') return {};
  try {
    const saved = sessionStorage.getItem(ATTRIBUTION_KEY);
    if (saved) return JSON.parse(saved) as AttributionProps;

    const params = new URLSearchParams(window.location.search);
    const referrerHost = safeHost(document.referrer);
    const organic = ORGANIC_HOSTS.some((part) => referrerHost.includes(part));
    const attribution: AttributionProps = {
      entry_path: window.location.pathname.slice(0, 256),
      referrer_host: referrerHost,
      traffic_kind: organic ? 'organic' : referrerHost ? 'referral' : 'direct',
    };
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
      const value = params.get(key);
      if (value) attribution[key] = value.slice(0, 120);
    }
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
    return attribution;
  } catch {
    return {};
  }
}

/**
 * 统一埋点：① Vercel Analytics（保留现网）；② 自有 Supabase（sendBeacon，
 * 即便随导航卸载也可靠送达）。两路都失败也绝不阻塞 UI。
 */
export function trackEvent(event: KnownEvent, props?: Props): void {
  const mergedProps = typeof window === 'undefined'
    ? (props ?? {})
    : { ...sessionAttribution(), ...(props ?? {}) };
  try {
    if (typeof window === 'undefined') return;
    const body = JSON.stringify({
      event,
      props: mergedProps,
      path: window.location.pathname,
      locale: document.documentElement.lang || undefined,
      sessionId: sessionId(),
      guestId: safeGuestId(),
    });
    if (recordingResourceGate.isActive() || recordingLifecycle.activeSession()) {
      deferredEvents.push({ event, props: mergedProps, body });
      return;
    }
    flushDeferredEvents();
    try { track(event, mergedProps); } catch { /* ignore */ }
    sendAnalyticsBody(body);
  } catch { /* never block UI */ }
}

const deferredEvents: Array<{ event: KnownEvent; props: Props; body: string }> = [];

function sendAnalyticsBody(body: string): void {
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/analytics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch { /* never block UI */ }
}

function flushDeferredEvents(): void {
  if (recordingResourceGate.isActive() || recordingLifecycle.activeSession()) return;
  for (const queued of deferredEvents.splice(0)) {
    try { track(queued.event, queued.props); } catch { /* ignore */ }
    sendAnalyticsBody(queued.body);
  }
}

if (typeof window !== 'undefined') {
  recordingResourceGate.subscribe((snapshot) => {
    if (!snapshot.active && deferredEvents.length > 0) queueMicrotask(flushDeferredEvents);
  });
}
