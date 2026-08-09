import { expect, test } from '@playwright/test';
import {
  createPaddleTransaction,
  diagnosePaddleConfiguration,
  diagnosePaddlePrice,
  fetchPaddlePrice,
  getPaddleApiBase,
  previewPaddlePaymentMethods,
} from '@/services/paddleServer';

test.describe('paddle server client', () => {
  test('uses Paddle sandbox API base from mode when api_base is not configured', () => {
    expect(getPaddleApiBase('test', null)).toBe('https://sandbox-api.paddle.com');
    expect(getPaddleApiBase('live', null)).toBe('https://api.paddle.com');
    expect(getPaddleApiBase('test', 'https://example.test')).toBe('https://example.test');
  });

  test('creates transaction with bearer auth and returns transaction id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: { id: 'txn_123' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await expect(createPaddleTransaction({
        mode: 'test',
        apiKey: 'pdl_api_key',
        apiBase: null,
        request: {
          collection_mode: 'automatic',
          items: [{ price_id: 'pri_123', quantity: 1 }],
          custom_data: { kind: 'one_time', recordingId: 'rec_123' },
        },
      })).resolves.toEqual({
        transactionId: 'txn_123',
        rawResponse: '{"data":{"id":"txn_123"}}',
      });
    } finally {
      globalThis.fetch = oldFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sandbox-api.paddle.com/transactions');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      authorization: 'Bearer pdl_api_key',
      'content-type': 'application/json',
    });
    expect(calls[0].init.body).toBe('{"collection_mode":"automatic","items":[{"price_id":"pri_123","quantity":1}],"custom_data":{"kind":"one_time","recordingId":"rec_123"}}');
  });

  test('reads the real Paddle price currency and billing cycle', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        data: {
          id: 'pri_one_time',
          unit_price: { amount: '499', currency_code: 'USD' },
          billing_cycle: null,
        },
      }), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(fetchPaddlePrice({
        mode: 'test', apiKey: 'pdl_api_key', apiBase: null, priceId: 'pri_one_time',
      })).resolves.toEqual({
        id: 'pri_one_time',
        currencyCode: 'USD',
        amount: '499',
        billingCycle: null,
      });
    } finally {
      globalThis.fetch = oldFetch;
    }

    expect(calls[0].url).toBe('https://sandbox-api.paddle.com/prices/pri_one_time');
    expect(calls[0].init.headers).toEqual({ authorization: 'Bearer pdl_api_key' });
  });

  test('previews China payment methods and preserves Paddle request id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        data: { available_payment_methods: ['card', 'alipay', 'wechat_pay'] },
        meta: { request_id: 'req_preview_123' },
      }), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(previewPaddlePaymentMethods({
        mode: 'test', apiKey: 'pdl_api_key', apiBase: null, priceId: 'pri_one_time', countryCode: 'CN',
      })).resolves.toEqual({
        availablePaymentMethods: ['card', 'alipay', 'wechat_pay'],
        requestId: 'req_preview_123',
      });
    } finally {
      globalThis.fetch = oldFetch;
    }

    expect(calls[0].url).toBe('https://sandbox-api.paddle.com/transactions/preview');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"items":[{"price_id":"pri_one_time","quantity":1}],"address":{"country_code":"CN"}}');
  });

  test('diagnoses product ids, recurring prices, and unsupported WeChat currencies', () => {
    expect(diagnosePaddlePrice({
      configuredId: 'pro_not_a_price',
      expectedKind: 'one_time',
      configuredCurrency: 'usd',
      price: null,
    })).toMatchObject({ valid: false, issues: ['paddle_price_id_required'] });

    expect(diagnosePaddlePrice({
      configuredId: 'pri_recurring',
      expectedKind: 'one_time',
      configuredCurrency: 'usd',
      price: {
        id: 'pri_recurring', currencyCode: 'USD', amount: '499',
        billingCycle: { interval: 'month', frequency: 1 },
      },
    })).toMatchObject({
      valid: false,
      billingType: 'subscription',
      issues: ['expected_one_time_price'],
      wechatCurrencyEligible: true,
    });

    expect(diagnosePaddlePrice({
      configuredId: 'pri_eur',
      expectedKind: 'one_time',
      configuredCurrency: 'usd',
      price: { id: 'pri_eur', currencyCode: 'EUR', amount: '499', billingCycle: null },
    })).toMatchObject({
      valid: false,
      billingType: 'one_time',
      issues: ['configured_currency_mismatch', 'wechat_currency_unsupported'],
      wechatCurrencyEligible: false,
    });
  });

  test('builds a secret-free admin report and previews WeChat only for the one-time price', async () => {
    const calls: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith('/prices/pri_one_time')) {
        return new Response(JSON.stringify({
          data: {
            id: 'pri_one_time', unit_price: { amount: '499', currency_code: 'USD' }, billing_cycle: null,
          },
        }), { status: 200 });
      }
      if (target.endsWith('/prices/pri_pro')) {
        return new Response(JSON.stringify({
          data: {
            id: 'pri_pro', unit_price: { amount: '1299', currency_code: 'USD' },
            billing_cycle: { interval: 'month', frequency: 1 },
          },
        }), { status: 200 });
      }
      if (target.endsWith('/transactions/preview')) {
        return new Response(JSON.stringify({
          data: { available_payment_methods: ['card', 'wechat_pay'] },
          meta: { request_id: 'req_wechat_check' },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 });
    }) as typeof fetch;

    try {
      const report = await diagnosePaddleConfiguration({
        mode: 'test',
        apiKey: 'pdl_api_key_must_not_leak',
        apiBase: null,
        configuredCurrency: 'usd',
        prices: {
          oneTime: 'pri_one_time',
          proMonthly: 'pri_pro',
          maxMonthly: null,
          proYearly: null,
          maxYearly: null,
        },
      });
      expect(report).toMatchObject({
        mode: 'test',
        configuredCurrency: 'USD',
        slots: {
          oneTime: { configuredId: 'pri_one_time', valid: true, billingType: 'one_time' },
          proMonthly: { configuredId: 'pri_pro', valid: true, billingType: 'subscription' },
          maxMonthly: { configuredId: null, valid: false, issues: ['paddle_price_id_required'] },
        },
        wechatPay: {
          countryCode: 'CN',
          desktopOnly: true,
          subscriptionsSupported: false,
          available: true,
          availablePaymentMethods: ['card', 'wechat_pay'],
          requestId: 'req_wechat_check',
        },
      });
      expect(JSON.stringify(report)).not.toContain('pdl_api_key_must_not_leak');
    } finally {
      globalThis.fetch = oldFetch;
    }

    expect(calls.filter((url) => url.endsWith('/transactions/preview'))).toHaveLength(1);
  });
});
