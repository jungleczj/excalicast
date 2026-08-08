import { expect, test } from '@playwright/test';
import {
  buildPaddleTransactionRequest,
  getCheckoutProductId,
  shouldApplySubscriptionEvent,
  extractPaddlePriceRefs,
  resolveHighestEntitlement,
  resolvePaddleEntitlement,
} from '@/lib/paymentDomain';

const products = {
  oneTimeProductId: 'pri_one_time',
  proProductId: 'pri_pro_monthly',
  maxProductId: 'pri_max_monthly',
  proYearlyProductId: 'pri_pro_yearly',
  maxYearlyProductId: 'pri_max_yearly',
};

test.describe('payment domain', () => {
  test('maps every checkout kind to the database product id', () => {
    expect(getCheckoutProductId(products, { kind: 'one_time' })).toBe('pri_one_time');
    expect(getCheckoutProductId(products, { kind: 'subscription', tier: 'pro', billing: 'monthly' })).toBe('pri_pro_monthly');
    expect(getCheckoutProductId(products, { kind: 'subscription', tier: 'pro', billing: 'yearly' })).toBe('pri_pro_yearly');
    expect(getCheckoutProductId(products, { kind: 'subscription', tier: 'max', billing: 'monthly' })).toBe('pri_max_monthly');
    expect(getCheckoutProductId(products, { kind: 'subscription', tier: 'max', billing: 'yearly' })).toBe('pri_max_yearly');
  });

  test('resolves Paddle entitlement from the paid price, never custom_data tier', () => {
    const entitlement = resolvePaddleEntitlement(
      [{ priceId: 'pri_pro_monthly' }],
      products,
    );
    expect(entitlement).toEqual({ kind: 'subscription', tier: 'pro', billing: 'monthly' });
  });

  test('chooses the highest currently entitled subscription across providers', () => {
    const now = Date.now();
    expect(resolveHighestEntitlement([
      { provider: 'creem', tier: 'pro', status: 'active', currentPeriodEnd: null },
      { provider: 'paddle', tier: 'max', status: 'cancelled', currentPeriodEnd: now + 60_000 },
      { provider: 'paddle', tier: 'max', status: 'cancelled', currentPeriodEnd: now - 1 },
    ], now)).toMatchObject({ provider: 'paddle', tier: 'max' });
  });

  test('builds Paddle transactions on the server with price id and custom ownership data', () => {
    expect(buildPaddleTransactionRequest({
      priceId: 'pri_pro_yearly',
      customData: {
        kind: 'subscription',
        userId: 'user_123',
        tier: 'max',
      },
    })).toEqual({
      collection_mode: 'automatic',
      items: [{ price_id: 'pri_pro_yearly', quantity: 1 }],
      custom_data: {
        kind: 'subscription',
        userId: 'user_123',
        tier: 'max',
      },
    });
  });

  test('extracts paid Paddle price ids from transaction line items', () => {
    const refs = extractPaddlePriceRefs({
      data: {
        items: [
          { price: { id: 'pri_max_yearly' } },
          { price_id: 'pri_unused_legacy_shape' },
        ],
      },
    });
    expect(refs).toEqual([{ priceId: 'pri_max_yearly' }, { priceId: 'pri_unused_legacy_shape' }]);
  });

  test('rejects stale subscription webhooks using occurred_at ordering', () => {
    expect(shouldApplySubscriptionEvent(
      Date.parse('2026-08-01T10:00:00.000Z'),
      Date.parse('2026-08-01T10:00:01.000Z'),
    )).toBe(false);
    expect(shouldApplySubscriptionEvent(
      Date.parse('2026-08-01T10:00:02.000Z'),
      Date.parse('2026-08-01T10:00:01.000Z'),
    )).toBe(true);
  });
});
