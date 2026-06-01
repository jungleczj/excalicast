'use client';

import type { ComponentProps, MouseEvent } from 'react';
import { track } from '@vercel/analytics';
import { Link } from '@/i18n/navigation';

type LinkProps = ComponentProps<typeof Link>;

/** Allowed Vercel Analytics custom-event property values. */
type EventProps = Record<string, string | number | boolean>;

/**
 * Drop-in replacement for the i18n <Link> that fires a Vercel Analytics
 * custom event on click before navigating. Used on conversion CTAs so we can
 * measure the natural-traffic → record → purchase funnel. Next does a client
 * soft-navigation (page does not unload), so the event reports reliably.
 */
export function TrackedLink({
  event,
  eventProps,
  onClick,
  ...rest
}: { event: string; eventProps?: EventProps } & LinkProps): JSX.Element {
  return (
    <Link
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        track(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
