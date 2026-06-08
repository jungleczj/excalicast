'use client';

import type { ComponentProps, MouseEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics/track';
import type { KnownEvent } from '@/lib/analytics/events';

type LinkProps = ComponentProps<typeof Link>;

/** Allowed custom-event property values. */
type EventProps = Record<string, string | number | boolean>;

/**
 * Drop-in replacement for the i18n <Link> that fires a custom analytics event
 * (Vercel Analytics + 自有 Supabase) on click before navigating. Used on
 * conversion CTAs to measure the natural-traffic → record → purchase funnel.
 */
export function TrackedLink({
  event,
  eventProps,
  onClick,
  ...rest
}: { event: KnownEvent; eventProps?: EventProps } & LinkProps): JSX.Element {
  return (
    <Link
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        trackEvent(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
