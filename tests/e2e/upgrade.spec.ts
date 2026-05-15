import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Regression test for: "Rendered more hooks than during the previous render"
 * triggered when clicking the 升级 Pro button in the AppHeader.
 *
 * Bug root cause (now fixed): ProUpgradeModal had a useEffect declared AFTER
 * `if (!open) return null`, which caused the hook count to change between
 * renders (1 hook when closed, 2 hooks when open).
 *
 * What we verify:
 *   1. No React error / hook error is logged when opening the modal.
 *   2. ProUpgradeModal opens with the expected "升级到 Pro" title.
 *   3. Clicking "先登录后再升级" opens the LoginModal (no longer a no-op).
 *   4. In DEV_MODE, the LoginModal shows the dev-credentials button
 *      ("直接登录（开发模式）"), confirming /api/auth/providers-info
 *      exposes devCredentials=true.
 *   5. After typing an email and submitting, LoginModal closes and the
 *      session establishes (useAuth().user goes truthy → resume effect
 *      fires; we don't actually trigger Paddle Checkout because Paddle.js
 *      requires a real checkout token, but we assert the upgrade modal
 *      content reflects the logged-in state — the "先登录后再升级"
 *      label flips to "立即升级 · …").
 */

const HOOK_ERROR_PATTERNS = [
  /Rendered more hooks than during the previous render/i,
  /Rendered fewer hooks than expected/i,
  /Hooks can only be called inside the body of a function component/i,
  /change in the order of Hooks/i,
];

function attachConsoleCollector(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return { errors };
}

function assertNoHookErrors(errors: string[]): void {
  const hookErrors = errors.filter((e) => HOOK_ERROR_PATTERNS.some((p) => p.test(e)));
  expect(hookErrors, `unexpected hook errors:\n${hookErrors.join('\n')}`).toHaveLength(0);
}

test.describe('ProUpgrade flow', () => {
  test('opening the upgrade modal does not crash with hook ordering errors', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await expect(page.getByText('升级 Pro', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByText('升级 Pro', { exact: true }).first().click();

    // ProUpgradeModal heading
    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible({ timeout: 5_000 });

    // Give React a tick to flush any pending render errors
    await page.waitForTimeout(500);
    assertNoHookErrors(errors);
  });

  test('clicking "先登录后再升级" actually opens LoginModal and dev login works', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await page.getByText('升级 Pro', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible({ timeout: 5_000 });

    // Free, not logged in → button label should be "先登录后再升级"
    const cta = page.getByRole('button', { name: /先登录后再升级/ });
    await expect(cta).toBeVisible();

    await cta.click();

    // LoginModal heading
    await expect(page.getByRole('heading', { name: '登录 Excalicast' })).toBeVisible({ timeout: 5_000 });

    // Dev-credentials submit button (DEV_MODE=true expected)
    const devLoginBtn = page.getByRole('button', { name: /直接登录（开发模式）/ });
    await expect(devLoginBtn).toBeVisible({ timeout: 5_000 });

    // Submit with a stable test email
    const testEmail = `playwright-${Date.now()}@example.com`;
    await page.getByPlaceholder('Enter your email').fill(testEmail);
    await devLoginBtn.click();

    // LoginModal should close
    await expect(page.getByRole('heading', { name: '登录 Excalicast' })).not.toBeVisible({ timeout: 10_000 });

    // After login, ProUpgradeModal CTA should switch off "先登录后再升级".
    // It will probably read "立即升级 · $9 / 月" OR "正在打开 Paddle…" if the
    // resume effect already fired. Either way, the old label must be gone.
    await expect(page.getByRole('button', { name: /先登录后再升级/ })).not.toBeVisible({ timeout: 8_000 });

    assertNoHookErrors(errors);
  });

  test('/api/auth/providers-info exposes devCredentials in DEV_MODE', async ({ request }) => {
    const res = await request.get('/api/auth/providers-info');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ devCredentials: true });
  });
});
