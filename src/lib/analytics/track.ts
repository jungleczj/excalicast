'use client';

import { track } from '@vercel/analytics';
import { getOrCreateGuestId } from '@/lib/ownerKey';
import type { KnownEvent } from './events';

type Props = Record<string, string | number | boolean>;

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

/**
 * 统一埋点：① Vercel Analytics（保留现网）；② 自有 Supabase（sendBeacon，
 * 即便随导航卸载也可靠送达）。两路都失败也绝不阻塞 UI。
 */
export function trackEvent(event: KnownEvent, props?: Props): void {
  try { track(event, props); } catch { /* ignore */ }

  try {
    if (typeof window === 'undefined') return;
    const body = JSON.stringify({
      event,
      props: props ?? {},
      path: window.location.pathname,
      locale: document.documentElement.lang || undefined,
      sessionId: sessionId(),
      guestId: safeGuestId(),
    });
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
