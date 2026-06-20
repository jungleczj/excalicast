import type { JSX } from 'react';
import { MonoTag } from '@/components/ui';

/**
 * 会员档位徽标 —— 全站单一来源，确保各页（录制页 AppHeader / 导出页顶栏 等）
 * 文案与样式一致（之前导出页是 "MAX PLAN" + MonoTag，AppHeader 是 "MAX" + tag-mono span，不一致）。
 */
export function TierBadge({ tier }: { tier: 'free' | 'pro' | 'max' }): JSX.Element {
  const label = tier === 'max' ? 'MAX' : tier === 'pro' ? 'PRO' : 'FREE';
  const variant = tier === 'max' ? 'max' : tier === 'pro' ? 'pro' : 'soft';
  return <MonoTag variant={variant}>{label}</MonoTag>;
}
