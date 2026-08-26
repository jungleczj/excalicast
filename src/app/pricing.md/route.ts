import { getActiveConfig } from '@/lib/paymentConfig';
import { formatPrice } from '@/lib/paymentConfig';

export const revalidate = 3600;

/**
 * Machine-readable pricing summary for crawlers and answer engines.
 * Values come from the same payment_config source as the visible pricing page.
 */
export async function GET(): Promise<Response> {
  const cfg = await getActiveConfig();
  const currency = cfg?.currency ?? 'usd';
  const oneTime = formatPrice(cfg?.oneTimePriceCents ?? 499, currency);
  const pro = formatPrice(cfg?.proMonthlyPriceCents ?? 999, currency);
  const max = formatPrice(cfg?.maxMonthlyPriceCents ?? 1599, currency);
  const body = `# Excalicast pricing

Excalicast uses the same public prices shown on https://excalicast.cc/en/pricing.

| Plan | Public price | What it is |
| --- | ---: | --- |
| Free | $0 | Record and export with the free-plan limits and watermark. |
| One-time export | ${oneTime} | One watermark-free local export. |
| Pro | ${pro}/month | Subscription features including captions and cloud-enabled workflows. |
| Max | ${max}/month | Advanced outputs including structured handouts and sharing features. |

Prices and feature availability may change. The localized pricing page is the canonical purchase reference.
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
