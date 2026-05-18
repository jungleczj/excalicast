'use client';

import { useLocale } from 'next-intl';
import type { SubscriptionTier } from '@/types/user';

const styles: Record<SubscriptionTier, { bg: string; text: string }> = {
  free: { bg: 'rgba(148,163,184,0.18)', text: '#cbd5e1' },
  pro:  { bg: 'linear-gradient(135deg,#3b82f6,#2563eb)', text: '#fff' },
  max:  { bg: 'linear-gradient(135deg,#a855f7,#7c3aed)', text: '#fff' },
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
        borderRadius: 999,
        padding,
        fontSize,
        letterSpacing: '0.06em',
        boxShadow: tier !== 'free' ? '0 2px 8px rgba(59,130,246,0.35)' : 'none',
      }}
    >
      {label}
    </span>
  );
}
