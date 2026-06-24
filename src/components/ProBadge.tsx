'use client';

import { useLocale } from 'next-intl';
import type { SubscriptionTier } from '@/types/user';

const styles: Record<SubscriptionTier, { bg: string; text: string }> = {
  free: { bg: 'var(--paper-2)', text: 'var(--ink-2)' },
  pro:  { bg: 'var(--pro)', text: 'var(--ink)' },
  max:  { bg: 'var(--max)', text: 'var(--ink)' },
};

export function ProBadge({ tier, size = 'sm' }: { tier: SubscriptionTier; size?: 'sm' | 'md' }): JSX.Element {
  const locale = useLocale();
  const labelMap: Record<SubscriptionTier, string> = {
    free: locale === 'en' ? 'Free' : '免费',
    pro: 'Pro',
    max: 'Max',
  };
  const s = styles[tier];
  const label = labelMap[tier];
  const padding = size === 'md' ? '4px 10px' : '2px 8px';
  const fontSize = size === 'md' ? 12 : 10;
  return (
    <span
      className="inline-flex items-center font-bold tracking-wide"
      style={{
        background: s.bg,
        color: s.text,
        border: '1.2px solid var(--ink)',
        borderRadius: 999,
        padding,
        fontSize,
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
  );
}
