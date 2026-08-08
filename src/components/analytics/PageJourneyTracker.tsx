'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackEvent } from '@/lib/analytics/track';

export function PageJourneyTracker(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || /\/(?:en|zh)\/admin(?:\/|$)/.test(pathname)) return;
    const startedAt = performance.now();
    let left = false;
    trackEvent('page_view');

    const leave = () => {
      if (left) return;
      left = true;
      trackEvent('journey_leave', {
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [pathname]);

  return null;
}
