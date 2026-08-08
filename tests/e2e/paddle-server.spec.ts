import { expect, test } from '@playwright/test';
import { createPaddleTransaction, getPaddleApiBase } from '@/services/paddleServer';

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
});
