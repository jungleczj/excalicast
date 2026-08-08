import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalicast-payment-db-'));
process.env.EXCALICAST_DB_PATH = path.join(dir, 'test.db');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const legacyDb = new Database(process.env.EXCALICAST_DB_PATH);
legacyDb.exec(`
  CREATE TABLE user_subscriptions (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'inactive',
    paddle_subscription_id TEXT,
    paddle_customer_id TEXT,
    current_period_end INTEGER,
    updated_at INTEGER NOT NULL,
    raw_payload TEXT
  );
  INSERT INTO user_subscriptions
    (user_id, tier, status, paddle_subscription_id, paddle_customer_id, current_period_end, updated_at, raw_payload)
  VALUES
    ('legacy_user', 'pro', 'active', 'legacy_sub', 'legacy_customer', NULL, 1000, '{}');
`);
legacyDb.close();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../../src/lib/db');

test.describe('payment storage', () => {
  test('migrates a legacy subscription table before creating provider indexes', async () => {
    await expect(db.getUserSubscription('legacy_user')).resolves.toMatchObject({
      userId: 'legacy_user',
      provider: 'paddle',
      tier: 'pro',
      status: 'active',
      providerSubscriptionId: 'legacy_sub',
    });
  });

  test('records and completes a checkout attempt with provider transaction id', async () => {
    const attempt = await db.insertCheckoutAttempt({
      provider: 'paddle',
      mode: 'test',
      kind: 'subscription',
      tier: 'pro',
      billing: 'monthly',
      recordingId: null,
      userId: 'user_123',
      productId: 'pri_pro_monthly',
      rawRequest: '{"items":[]}',
    });

    await db.completeCheckoutAttempt({
      id: attempt.id,
      providerTransactionId: 'txn_123',
      rawResponse: '{"data":{"id":"txn_123"}}',
    });

    expect(await db.getCheckoutAttempt(attempt.id)).toMatchObject({
      provider: 'paddle',
      mode: 'test',
      kind: 'subscription',
      tier: 'pro',
      billing: 'monthly',
      user_id: 'user_123',
      provider_transaction_id: 'txn_123',
      status: 'created',
    });
  });

  test('deduplicates webhook events by provider and event id', async () => {
    const first = await db.recordPaymentWebhookEvent({
      provider: 'paddle',
      eventId: 'evt_123',
      eventType: 'subscription.updated',
      occurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
      rawPayload: '{}',
    });
    const second = await db.recordPaymentWebhookEvent({
      provider: 'paddle',
      eventId: 'evt_123',
      eventType: 'subscription.updated',
      occurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
      rawPayload: '{}',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    await db.releasePaymentWebhookEvent('paddle', 'evt_123');
    const retry = await db.recordPaymentWebhookEvent({
      provider: 'paddle',
      eventId: 'evt_123',
      eventType: 'subscription.updated',
      occurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
      rawPayload: '{}',
    });
    expect(retry.duplicate).toBe(false);
  });

  test('keeps highest provider-neutral entitlement and ignores stale subscription events', async () => {
    await db.upsertProviderSubscription({
      userId: 'user_123',
      provider: 'creem',
      tier: 'pro',
      status: 'active',
      providerSubscriptionId: 'creem_sub_123',
      providerCustomerId: 'creem_cust_123',
      currentPeriodEnd: null,
      eventOccurredAt: Date.parse('2026-08-01T10:00:00.000Z'),
      rawPayload: '{"provider":"creem"}',
    });
    await db.upsertProviderSubscription({
      userId: 'user_123',
      provider: 'paddle',
      tier: 'max',
      status: 'active',
      providerSubscriptionId: 'sub_123',
      providerCustomerId: 'ctm_123',
      currentPeriodEnd: null,
      eventOccurredAt: Date.parse('2026-08-01T10:00:10.000Z'),
      rawPayload: '{"provider":"paddle"}',
    });
    await db.upsertProviderSubscription({
      userId: 'user_123',
      provider: 'paddle',
      tier: 'pro',
      status: 'cancelled',
      providerSubscriptionId: 'sub_123',
      providerCustomerId: 'ctm_123',
      currentPeriodEnd: null,
      eventOccurredAt: Date.parse('2026-08-01T10:00:05.000Z'),
      rawPayload: '{"stale":true}',
    });

    expect(await db.getUserSubscription('user_123')).toMatchObject({
      userId: 'user_123',
      tier: 'max',
      status: 'active',
      provider: 'paddle',
      providerSubscriptionId: 'sub_123',
    });
  });
});
