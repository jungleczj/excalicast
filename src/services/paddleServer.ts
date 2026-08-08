import type { PaymentMode } from '@/lib/paymentConfig';
import type { PaddleTransactionRequest } from '@/lib/paymentDomain';

export function getPaddleApiBase(mode: PaymentMode, configuredBase: string | null): string {
  return (configuredBase ?? (mode === 'test' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com')).replace(/\/+$/, '');
}

export async function createPaddleTransaction(params: {
  mode: PaymentMode;
  apiKey: string;
  apiBase: string | null;
  request: PaddleTransactionRequest;
}): Promise<{ transactionId: string; rawResponse: string }> {
  const res = await fetch(`${getPaddleApiBase(params.mode, params.apiBase)}/transactions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params.request),
  });
  const rawResponse = await res.text();
  if (!res.ok) {
    throw new Error(`paddle_transaction_failed:${res.status}:${rawResponse}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(rawResponse) as unknown;
  } catch {
    throw new Error('paddle_transaction_invalid_json');
  }
  const data = json && typeof json === 'object' ? (json as Record<string, unknown>).data : null;
  const transactionId = data && typeof data === 'object' && typeof (data as Record<string, unknown>).id === 'string'
    ? (data as Record<string, string>).id
    : '';
  if (!transactionId) {
    throw new Error('paddle_transaction_missing_id');
  }
  return { transactionId, rawResponse };
}
