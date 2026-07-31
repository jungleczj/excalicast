'use client';

import { useEffect } from 'react';
import { sessionAttribution, trackEvent } from '@/lib/analytics/track';

const TRACKED_KEY = 'excalicast.organicLandingTracked';

export function OrganicLandingTracker(): null {
  useEffect(() => {
    try {
      const attribution = sessionAttribution();
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
