import type { PaymentMode } from '@/lib/paymentConfig';
import type { PaddleTransactionRequest } from '@/lib/paymentDomain';

export interface PaddlePrice {
  id: string;
  currencyCode: string;
  amount: string;
  billingCycle: { interval: string; frequency: number } | null;
}

export interface PaddlePriceDiagnosis {
  configuredId: string | null;
  valid: boolean;
  currencyCode: string | null;
  billingType: 'one_time' | 'subscription' | null;
  wechatCurrencyEligible: boolean;
  issues: string[];
}

export interface PaddleConfigurationDiagnosis {
  mode: PaymentMode;
  configuredCurrency: string;
  slots: Record<PaddlePriceSlot, PaddlePriceDiagnosis & { amount: string | null; errorCode?: string }>;
  wechatPay: {
    countryCode: 'CN';
    desktopOnly: true;
    subscriptionsSupported: false;
    available: boolean;
    availablePaymentMethods: string[];
    requestId: string | null;
    errorCode?: string;
  };
}

type PaddlePriceSlot = 'oneTime' | 'proMonthly' | 'maxMonthly' | 'proYearly' | 'maxYearly';

export function getPaddleApiBase(mode: PaymentMode, configuredBase: string | null): string {
  return (configuredBase ?? (mode === 'test' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com')).replace(/\/+$/, '');
}

async function readPaddleJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${operation}_invalid_json`);
  }
  if (!response.ok) {
    const root = json && typeof json === 'object' ? json as Record<string, unknown> : {};
    const error = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : {};
    const code = typeof error.code === 'string' && /^[a-z0-9_]{2,64}$/i.test(error.code)
      ? error.code
      : 'request_failed';
    throw new Error(`${operation}:${response.status}:${code}`);
  }
  if (!json || typeof json !== 'object') throw new Error(`${operation}_invalid_json`);
  return json as Record<string, unknown>;
}

export async function fetchPaddlePrice(params: {
  mode: PaymentMode;
  apiKey: string;
  apiBase: string | null;
  priceId: string;
}): Promise<PaddlePrice> {
  if (!params.priceId.startsWith('pri_')) throw new Error('paddle_price_id_required');
  const response = await fetch(
    `${getPaddleApiBase(params.mode, params.apiBase)}/prices/${encodeURIComponent(params.priceId)}`,
    { headers: { authorization: `Bearer ${params.apiKey}` } },
  );
  const json = await readPaddleJson(response, 'paddle_price_failed');
  const data = json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : null;
  const unitPrice = data?.unit_price && typeof data.unit_price === 'object'
    ? data.unit_price as Record<string, unknown>
    : null;
  const billing = data?.billing_cycle && typeof data.billing_cycle === 'object'
    ? data.billing_cycle as Record<string, unknown>
    : null;
  if (!data || typeof data.id !== 'string' || typeof unitPrice?.currency_code !== 'string' || typeof unitPrice.amount !== 'string') {
    throw new Error('paddle_price_invalid_response');
  }
  return {
    id: data.id,
    currencyCode: unitPrice.currency_code.toUpperCase(),
    amount: unitPrice.amount,
    billingCycle: billing && typeof billing.interval === 'string' && typeof billing.frequency === 'number'
      ? { interval: billing.interval, frequency: billing.frequency }
      : null,
  };
}

export async function previewPaddlePaymentMethods(params: {
  mode: PaymentMode;
  apiKey: string;
  apiBase: string | null;
  priceId: string;
  countryCode: string;
}): Promise<{ availablePaymentMethods: string[]; requestId: string | null }> {
  if (!params.priceId.startsWith('pri_')) throw new Error('paddle_price_id_required');
  const countryCode = params.countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('paddle_country_code_invalid');
  const response = await fetch(`${getPaddleApiBase(params.mode, params.apiBase)}/transactions/preview`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      items: [{ price_id: params.priceId, quantity: 1 }],
      address: { country_code: countryCode },
    }),
  });
  const json = await readPaddleJson(response, 'paddle_preview_failed');
  const data = json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : null;
  const meta = json.meta && typeof json.meta === 'object' ? json.meta as Record<string, unknown> : null;
  const methods = Array.isArray(data?.available_payment_methods)
    ? data.available_payment_methods.filter((method): method is string => typeof method === 'string')
    : [];
  return {
    availablePaymentMethods: methods,
    requestId: typeof meta?.request_id === 'string' ? meta.request_id : null,
  };
}

export function diagnosePaddlePrice(params: {
  configuredId: string | null;
  expectedKind: 'one_time' | 'subscription';
  configuredCurrency: string;
  price: PaddlePrice | null;
}): PaddlePriceDiagnosis {
  const issues: string[] = [];
  if (!params.configuredId?.startsWith('pri_')) issues.push('paddle_price_id_required');
  if (params.configuredId?.startsWith('pri_') && !params.price) issues.push('paddle_price_unavailable');

  const currencyCode = params.price?.currencyCode.toUpperCase() ?? null;
  const billingType = params.price ? (params.price.billingCycle ? 'subscription' : 'one_time') : null;
  const wechatCurrencyEligible = currencyCode === 'USD' || currencyCode === 'CNY';
  if (params.price) {
    if (params.expectedKind === 'one_time' && billingType !== 'one_time') issues.push('expected_one_time_price');
    if (params.expectedKind === 'subscription' && billingType !== 'subscription') issues.push('expected_subscription_price');
    if (currencyCode !== params.configuredCurrency.toUpperCase()) issues.push('configured_currency_mismatch');
    if (params.expectedKind === 'one_time' && !wechatCurrencyEligible) issues.push('wechat_currency_unsupported');
  }
  return {
    configuredId: params.configuredId,
    valid: issues.length === 0,
    currencyCode,
    billingType,
    wechatCurrencyEligible,
    issues,
  };
}

function safePaddleDiagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const match = message.match(/^(paddle_[a-z0-9_]+)(?::(\d{3}):([a-z0-9_]+))?$/i);
  if (!match) return 'paddle_api_unavailable';
  return [match[1], match[2], match[3]].filter(Boolean).join(':');
}

export async function diagnosePaddleConfiguration(params: {
  mode: PaymentMode;
  apiKey: string;
  apiBase: string | null;
  configuredCurrency: string;
  prices: Record<PaddlePriceSlot, string | null>;
}): Promise<PaddleConfigurationDiagnosis> {
  const configuredCurrency = params.configuredCurrency.toUpperCase();
  const slotNames = Object.keys(params.prices) as PaddlePriceSlot[];
  const entries = await Promise.all(slotNames.map(async (slot) => {
    const configuredId = params.prices[slot];
    const expectedKind = slot === 'oneTime' ? 'one_time' : 'subscription';
    let price: PaddlePrice | null = null;
    let errorCode: string | undefined;
    if (configuredId?.startsWith('pri_')) {
      try {
        price = await fetchPaddlePrice({
          mode: params.mode,
          apiKey: params.apiKey,
          apiBase: params.apiBase,
          priceId: configuredId,
        });
      } catch (error) {
        errorCode = safePaddleDiagnosticCode(error);
      }
    }
    const diagnosis = diagnosePaddlePrice({
      configuredId,
      expectedKind,
      configuredCurrency,
      price,
    });
    return [slot, {
      ...diagnosis,
      amount: price?.amount ?? null,
      ...(errorCode ? { errorCode } : {}),
    }] as const;
  }));
  const slots = Object.fromEntries(entries) as PaddleConfigurationDiagnosis['slots'];

  let availablePaymentMethods: string[] = [];
  let requestId: string | null = null;
  let previewErrorCode: string | undefined;
  if (slots.oneTime.valid && slots.oneTime.configuredId) {
    try {
      const preview = await previewPaddlePaymentMethods({
        mode: params.mode,
        apiKey: params.apiKey,
        apiBase: params.apiBase,
        priceId: slots.oneTime.configuredId,
        countryCode: 'CN',
      });
      availablePaymentMethods = preview.availablePaymentMethods;
      requestId = preview.requestId;
    } catch (error) {
      previewErrorCode = safePaddleDiagnosticCode(error);
    }
  }

  return {
    mode: params.mode,
    configuredCurrency,
    slots,
    wechatPay: {
      countryCode: 'CN',
      desktopOnly: true,
      subscriptionsSupported: false,
      available: availablePaymentMethods.includes('wechat_pay'),
      availablePaymentMethods,
      requestId,
      ...(previewErrorCode ? { errorCode: previewErrorCode } : {}),
    },
  };
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
