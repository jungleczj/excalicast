export type SubscriptionTier = 'free' | 'pro' | 'max';

export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'paused' | 'cancelled';

export const FREE_DURATION_LIMIT_MS = 30 * 60 * 1000;
export const FREE_DURATION_WARN_MS = 25 * 60 * 1000;

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
  unlimitedDuration: boolean;
  subtitle: boolean;
  cloudBackup: boolean;
  shareLink: boolean;
  handout: boolean;
}

export const TIER_PERMISSIONS: Record<SubscriptionTier, TierPermissions> = {
  free: {
    exportWithoutWatermark: false,
    unlimitedDuration: false,
    subtitle: false,
    cloudBackup: false,
    shareLink: false,
    handout: false,
  },
  pro: {
    exportWithoutWatermark: true,
    unlimitedDuration: true,
    subtitle: true,
    cloudBackup: true,
    shareLink: false,
    handout: false,
  },
  max: {
    exportWithoutWatermark: true,
    unlimitedDuration: true,
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
