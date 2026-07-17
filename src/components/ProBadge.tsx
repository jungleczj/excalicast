'use client';

import { useLocale } from 'next-intl';
import type { SubscriptionTier } from '@/types/user';

const styles: Record<SubscriptionTier, { bg: string; text: string }> = {
  free: { bg: 'rgba(24,25,26,0.045)', text: 'rgba(24,25,26,0.58)' },
  pro:  { bg: 'rgba(255,216,112,0.78)', text: '#2f230d' },
  max:  { bg: 'rgba(221,210,242,0.62)', text: 'rgba(24,25,26,0.72)' },
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
      className="pro-badge-craft inline-flex items-center font-bold tracking-wide"
      style={{
        background: s.bg,
        color: s.text,
        border: '1px solid var(--craft-line)',
        borderRadius: 999,
        padding,
        fontSize,
        letterSpacing: '-0.01em',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.66)',
      }}
    >
      {label}
    </span>
  );
}
