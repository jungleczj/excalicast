'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/analytics/track';

export function ContentPageTracker({
  type,
  slug,
}: {
  type: 'pillar' | 'compare' | 'use-case' | 'blog';
  slug: string;
}): null {
  useEffect(() => {
    trackEvent('content_page_view', { content_type: type, slug });
    if (type === 'compare') trackEvent('comparison_view', { slug });
  }, [slug, type]);

  return null;
}
