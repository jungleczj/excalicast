'use client';

import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { formatPrice } from '@/lib/formatPrice';
import { MonoTag } from '@/components/ui';
import { TrackedLink } from '@/components/analytics/TrackedLink';

interface Tier {
  key: 'free' | 'oneTime' | 'pro' | 'max';
  trackTier: 'free' | 'one_time' | 'pro' | 'max';
  color: string;
  primary: boolean;
  on: boolean[];
}

const TIERS: Tier[] = [
  { key: 'free', trackTier: 'free', color: 'var(--paper)', primary: false, on: [true, true, true, true, false, false, false] },
  { key: 'oneTime', trackTier: 'one_time', color: 'var(--paper)', primary: false, on: [true, true, true, true, false, false, false] },
  { key: 'pro', trackTier: 'pro', color: 'var(--pro)', primary: false, on: [true, true, true, true, true, true, true, false] },
  { key: 'max', trackTier: 'max', color: 'var(--max)', primary: true, on: [true, true, true, true, true, true, true, true] },
];

export function PricingTiers({
  oneTimeCents,
  proCents,
  maxCents,
  proYearlyCents,
  maxYearlyCents,
  yearlyAvailable,
  currency,
}: {
  oneTimeCents: number;
  proCents: number;
  maxCents: number;
  proYearlyCents: number;
  maxYearlyCents: number;
  yearlyAvailable: boolean;
  currency: string;
}): JSX.Element {
  const t = useTranslations('pricingPage');
  const tl = useTranslations('landing.pricing');
  const [yearly, setYearly] = useState(false);

  // 年付仅在已配置年付 product 时可选；否则强制按月并隐藏切换。
  const showYearly = yearlyAvailable && yearly;
  // 年价存的是「年度总价」；定价页按「折合每月（年付）」展示，与 perMonthYearly 文案一致。
  const monthlyEquivYearly = (annualCents: number) => Math.round(annualCents / 12);
  const priceFor = (key: Tier['key']): { price: string; unit: string } => {
    if (key === 'free') return { price: '$0', unit: t('units.free') };
    if (key === 'oneTime') return { price: formatPrice(oneTimeCents, currency), unit: t('units.oneTime') };
    if (showYearly) {
      const annual = key === 'pro' ? proYearlyCents : maxYearlyCents;
      return { price: formatPrice(monthlyEquivYearly(annual), currency), unit: t('perMonthYearly') };
    }
    return { price: formatPrice(key === 'pro' ? proCents : maxCents, currency), unit: t('units.pro') };
  };
  const nameFor = (key: Tier['key']) => tl(`${key}.label`);

  return (
    <>
      {yearlyAvailable && (
        <div className="mb-7 flex flex-wrap items-center justify-center gap-2.5">
          <div className="pricing-craft-billing-toggle" style={{ display: 'inline-flex', padding: 4, border: '1.5px solid var(--ink)', borderRadius: 999, background: 'var(--paper)', boxShadow: '2px 2px 0 var(--ink)' }}>
            {(['monthly', 'yearly'] as const).map((m) => {
              const active = (m === 'yearly') === yearly;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setYearly(m === 'yearly')}
                  data-active={active}
                  style={{ padding: '8px 18px', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--paper)' : 'var(--ink)', border: 'none', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  {t(m)}
                </button>
              );
            })}
          </div>
          <MonoTag variant="hi">{t('saveBadge')}</MonoTag>
        </div>
      )}

      <div className="pricing-craft-tier-grid stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" style={{ alignItems: 'start' }}>
        {TIERS.map((tier) => {
          const { price, unit } = priceFor(tier.key);
          const features = t.raw(`tiers.${tier.key}.features`) as string[];
          return (
            <div key={tier.key} className="pricing-craft-tier reveal-up" data-tier={tier.key} data-primary={tier.primary} style={{ position: 'relative', background: tier.color, border: '1.8px solid var(--ink)', borderRadius: 4, boxShadow: tier.primary ? '6px 6px 0 var(--ink)' : '3px 3px 0 var(--ink)', padding: 28, display: 'flex', flexDirection: 'column' }}>
              {tier.primary && (
                <div style={{ position: 'absolute', top: -16, right: 18 }}>
                  <span className="pricing-craft-badge">★ {t('tiers.max.badge')}</span>
                </div>
              )}
              <div className="pricing-craft-tier-name" style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{nameFor(tier.key)}</div>
              <div style={{ marginTop: 10, marginBottom: 14 }}>
                <span className="pricing-craft-price" style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.025em' }}>{price}</span>
                <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--ink-2)' }}>{unit}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0, marginBottom: 18, minHeight: 60 }}>{t(`tiers.${tier.key}.tagline`)}</p>
              <TrackedLink
                event="pricing_cta_click"
                eventProps={{ tier: tier.trackTier, surface: 'pricing_page' }}
                href="/app"
                className={'btn-sketch btn-stamp w-full' + (tier.primary ? ' btn-sketch-primary' : '')}
                style={{ justifyContent: 'center', marginBottom: 18 }}
              >
                {t(`tiers.${tier.key}.cta`)} <I.ArrowRight size={13} />
              </TrackedLink>
              <div className="pricing-craft-divider" style={{ height: 1.5, background: 'var(--ink)', opacity: 0.3, marginBottom: 16 }} />
              <div style={{ display: 'grid', gap: 4 }}>
                {features.map((f, i) => {
                  const on = tier.on[i] ?? true;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '3px 0' }}>
                      <div style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {on ? <I.Check size={14} sw={2.4} /> : <I.Close size={14} sw={1.8} />}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: on ? 'var(--ink)' : 'var(--ink-4)', textDecoration: on ? 'none' : 'line-through', textDecorationColor: 'var(--ink-4)' }}>{f}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
