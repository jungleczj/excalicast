export type SubscriptionTier = 'free' | 'pro' | 'max';

export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'paused' | 'cancelled';

// ⚠️ 录制时长无任何上限（不分 tier）。不要再引入 FREE_DURATION_LIMIT_MS / 自动停止 / 警告 banner。
// 见 CLAUDE.md 禁止事项。

export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  currentPeriodEnd: number | null; // ms epoch
  updatedAt: number;
}

export interface TierPermissions {
  exportWithoutWatermark: boolean;
  subtitle: boolean;
  cloudBackup: boolean;
  shareLink: boolean;
  handout: boolean;
}

export const TIER_PERMISSIONS: Record<SubscriptionTier, TierPermissions> = {
  free: {
    exportWithoutWatermark: false,
    subtitle: false,
    cloudBackup: false,
    shareLink: false,
    handout: false,
  },
  pro: {
    exportWithoutWatermark: true,
    subtitle: true,
    cloudBackup: true,
    shareLink: false,
    handout: false,
  },
  max: {
    exportWithoutWatermark: true,
    subtitle: true,
    cloudBackup: true,
    shareLink: true,
    handout: true,
  },
};

export function tierLabel(tier: SubscriptionTier): string {
  switch (tier) {
    case 'free': return '免费版';
    case 'pro': return 'Pro';
    case 'max': return 'Max';
  }
}

export interface TierResponse {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
  loggedIn: boolean;
}
