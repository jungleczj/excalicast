'use client';

import { useRef, type ComponentProps, type MouseEvent } from 'react';
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
 *
 * `prefetchKind`：可选「重模块预热」。指向重路由的 CTA（如开始录制 → 白板/Excalidraw）
 * 在 hover / pointerdown 时预载对应动态 chunk —— 路由 prefetch 只取路由自身 chunk、
 * 不含动态 import 的子 chunk，故大组件需单独预热（dev 把首次按需编译前移到悬停、生产把
 * 大 chunk 下载前移），点击近乎即时。用字符串键（而非函数）以便从 Server Component 传入。
 */
const PREFETCHERS: Record<string, () => Promise<unknown>> = {
  // 录制页最重的子 chunk：白板（连带 Excalidraw）。
  whiteboard: () => import('@/components/Whiteboard'),
};

export function TrackedLink({
  event,
  eventProps,
  prefetchKind,
  onClick,
  onMouseEnter,
  onPointerDown,
  ...rest
}: {
  event: KnownEvent;
  eventProps?: EventProps;
  prefetchKind?: keyof typeof PREFETCHERS;
} & LinkProps): JSX.Element {
  const warmed = useRef(false);
  const warm = () => {
    if (warmed.current || !prefetchKind) return;
    warmed.current = true;
    void PREFETCHERS[prefetchKind]().catch(() => { warmed.current = false; });
  };
  return (
    <Link
      {...rest}
      onMouseEnter={(e) => { warm(); onMouseEnter?.(e); }}
      onPointerDown={(e) => { warm(); onPointerDown?.(e); }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        trackEvent(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
