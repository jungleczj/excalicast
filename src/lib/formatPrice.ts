/**
 * Client-safe price formatter. No Node imports → safe to bundle for browser.
 * The full payment-config module (`@/lib/paymentConfig`) pulls in
 * `better-sqlite3` + `node:fs`, so anything that crosses into client code
 * (hooks / components) imports this helper instead.
 */
export function formatPrice(cents: number, currency: string): string {
  const symbol = (() => {
    switch (currency.toLowerCase()) {
      case 'usd': return '$';
      case 'eur': return '€';
      case 'gbp': return '£';
      case 'cny': return '¥';
      case 'jpy': return '¥';
      default: return '';
    }
  })();
  const integral = Math.floor(cents / 100);
  const frac = cents % 100;
  if (currency.toLowerCase() === 'jpy') return `${symbol}${integral}`;
  if (frac === 0) return `${symbol}${integral}`;
  return `${symbol}${integral}.${frac.toString().padStart(2, '0')}`;
}
