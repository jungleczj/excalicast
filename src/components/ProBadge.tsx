'use client';

import type { SubscriptionTier } from '@/types/user';

const styles: Record<SubscriptionTier, { bg: string; text: string; label: string }> = {
  free: { bg: 'rgba(148,163,184,0.18)', text: '#cbd5e1', label: '免费' },
  pro: { bg: 'linear-gradient(135deg,#3b82f6,#2563eb)', text: '#fff', label: 'Pro' },
  max: { bg: 'linear-gradient(135deg,#a855f7,#7c3aed)', text: '#fff', label: 'Max' },
};

export function ProBadge({ tier, size = 'sm' }: { tier: SubscriptionTier; size?: 'sm' | 'md' }): JSX.Element {
  const s = styles[tier];
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
      {s.label}
    </span>
  );
}
