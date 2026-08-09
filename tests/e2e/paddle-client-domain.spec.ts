import { expect, test } from '@playwright/test';
import { normalizePaddleCheckoutEvent } from '@/services/paddleClient';

test('normalizes Paddle checkout warnings without retaining buyer details', () => {
  const event = normalizePaddleCheckoutEvent({
    type: 'checkout.warning',
    code: 'checkout_creation_invalid_field',
    detail: 'Invalid customer email secret@example.com',
    documentation_url: 'https://developer.paddle.com/errors/shared/invalid_field',
    errors: [{ field: '/data/customer', message: 'secret@example.com is invalid' }],
  });

  expect(event).toEqual({
    name: 'checkout.warning',
    data: {
      code: 'checkout_creation_invalid_field',
      documentationUrl: 'https://developer.paddle.com/errors/shared/invalid_field',
      fields: ['/data/customer'],
    },
  });
  expect(JSON.stringify(event)).not.toContain('secret@example.com');
});

test('preserves normal checkout data and extracts its transaction id', () => {
  expect(normalizePaddleCheckoutEvent({
    name: 'checkout.loaded',
    data: { transaction_id: 'txn_123', currency_code: 'USD' },
  })).toEqual({
    name: 'checkout.loaded',
    data: { transaction_id: 'txn_123', currency_code: 'USD' },
    diagnostic: { transactionId: 'txn_123' },
  });
});

test('ignores objects that are not Paddle checkout events', () => {
  expect(normalizePaddleCheckoutEvent({ code: 'unknown' })).toBeNull();
});
