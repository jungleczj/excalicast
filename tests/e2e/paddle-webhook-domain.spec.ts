import { expect, test } from '@playwright/test';
import {
  getPaddleWebhookMeta,
  parseSubscriptionEvent,
  parseTransactionCompleted,
} from '@/lib/paddle';

const products = {
  oneTimeProductId: 'pri_one_time',
  proProductId: 'pri_pro_monthly',
  maxProductId: 'pri_max_monthly',
  proYearlyProductId: 'pri_pro_yearly',
  maxYearlyProductId: 'pri_max_yearly',
};

test.describe('paddle webhook domain', () => {
  test('extracts webhook id and occurred_at for idempotency and ordering', () => {
    expect(getPaddleWebhookMeta({
      event_id: 'evt_123',
      event_type: 'subscription.updated',
      occurred_at: '2026-08-01T10:00:00.000Z',
    })).toEqual({
      eventId: 'evt_123',
      eventType: 'subscription.updated',
      occurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
    });
  });

  test('resolves subscription tier from paid price id instead of custom_data tier', () => {
    const event = parseSubscriptionEvent({
      event_id: 'evt_123',
      event_type: 'subscription.updated',
      occurred_at: '2026-08-01T10:00:00.000Z',
      data: {
        id: 'sub_123',
        customer_id: 'ctm_123',
        status: 'active',
        custom_data: { userId: 'user_123', tier: 'pro' },
        items: [{ price: { id: 'pri_max_yearly' } }],
        current_billing_period: { ends_at: '2026-09-01T10:00:00.000Z' },
      },
    }, products);

    expect(event).toMatchObject({
      subscriptionId: 'sub_123',
      userId: 'user_123',
      tier: 'max',
      billing: 'yearly',
      occurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
    });
  });

  test('only treats transaction.completed as one-time when paid price matches one-time product id', () => {
    expect(parseTransactionCompleted({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_123',
        currency_code: 'USD',
        custom_data: { recordingId: 'rec_123' },
        items: [{ price: { id: 'pri_pro_monthly' } }],
        details: { totals: { total: '999' } },
      },
    }, products)).toBeNull();

    expect(parseTransactionCompleted({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_124',
        currency_code: 'USD',
        custom_data: { recordingId: 'rec_124' },
        items: [{ price: { id: 'pri_one_time' } }],
        details: { totals: { total: '499' } },
      },
    }, products)).toMatchObject({
      transactionId: 'txn_124',
      recordingId: 'rec_124',
      amountCents: 499,
      currency: 'usd',
    });
  });
});
