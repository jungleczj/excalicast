'use client';

import { useEffect } from 'react';
import { sessionAttribution, trackEvent } from '@/lib/analytics/track';

const TRACKED_KEY = 'excalicast.organicLandingTracked';

export function OrganicLandingTracker(): null {
  useEffect(() => {
    try {
      const attribution = sessionAttribution();
      const url = new URL(window.location.href);
      const authEvent = url.searchParams.get('auth_event');
      if (authEvent === 'signup' || authEvent === 'login') {
        trackEvent(authEvent);
        url.searchParams.delete('auth_event');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
      if (attribution.traffic_kind !== 'organic') return;
      if (sessionStorage.getItem(TRACKED_KEY)) return;
      sessionStorage.setItem(TRACKED_KEY, '1');
      trackEvent('organic_landing_view');
    } catch {
      // Analytics must never affect navigation.
    }
  }, []);

  return null;
}
