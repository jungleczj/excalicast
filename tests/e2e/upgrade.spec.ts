import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * E2E for the Supabase-Auth upgrade flow.
 *
 * Covers:
 *   1. Hook ordering regression — ProUpgradeModal opens with no
 *      "Rendered more hooks than during the previous render" error.
 *   2. "先登录后再升级" actually opens LoginModal (no-op bug regression).
 *   3. LoginModal renders the production-grade magic link form
 *      (Continue with Google + email input + 发送登录链接到邮箱),
 *      with **no** "开发模式" / "直接登录" wording.
 *   4. Submitting the email triggers a POST to Supabase's
 *      /auth/v1/otp endpoint (so the real Supabase Magic Link API is in
 *      play, not a custom Resend path).
 *   5. The /api/auth/callback route exists — request without a `code`
 *      query param redirects with login_error=missing_code (we accept
 *      either a 3xx redirect or the resulting page query string).
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
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return { errors };
}

function assertNoHookErrors(errors: string[]): void {
  const hookErrors = errors.filter((e) => HOOK_ERROR_PATTERNS.some((p) => p.test(e)));
  expect(hookErrors, `unexpected hook errors:\n${hookErrors.join('\n')}`).toHaveLength(0);
}

test.describe('ProUpgrade + Supabase Auth LoginModal', () => {
  test('opening ProUpgradeModal does not crash (hook ordering ok)', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await expect(page.getByText('升级 Pro', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('升级 Pro', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);
    assertNoHookErrors(errors);
  });

  test('"先登录后再升级" opens LoginModal with production magic link form', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await page.getByText('升级 Pro', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible();

    await page.getByRole('button', { name: /先登录后再升级/ }).click();
    await expect(page.getByRole('heading', { name: '登录 Excalicast' })).toBeVisible({ timeout: 5_000 });

    // Production wording only
    await expect(page.getByText('Continue with Google')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送登录链接到邮箱' })).toBeVisible();

    // Absolutely no dev-mode / dev-credentials wording
    await expect(page.getByText(/开发模式/)).toHaveCount(0);
    await expect(page.getByText(/直接登录/)).toHaveCount(0);

    // No leftover NextAuth wording (e.g. "登录账号以解锁未来" from old copy)
    await expect(page.getByText('登录账号以解锁 Pro 功能。录制 + 单次购买无需登录。')).toBeVisible();

    assertNoHookErrors(errors);
  });

  test('email submit fires POST to Supabase /auth/v1/otp', async ({ page }) => {
    await page.goto('/app');

    // Intercept the Supabase OTP request and stub a 200 so we don't hit
    // the real backend. Captures whether the request was actually made.
    let otpHit = false;
    let otpBody: unknown = null;
    await page.route('**/auth/v1/otp**', async (route) => {
      otpHit = true;
      try {
        otpBody = JSON.parse(route.request().postData() ?? 'null');
      } catch {
        otpBody = route.request().postData();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.getByText('升级 Pro', { exact: true }).first().click();
    await page.getByRole('button', { name: /先登录后再升级/ }).click();
    await page.getByPlaceholder('Enter your email').fill('e2e@example.com');
    await page.getByRole('button', { name: '发送登录链接到邮箱' }).click();

    // Success state in UI
    await expect(page.getByText('登录邮件已发送')).toBeVisible({ timeout: 5_000 });

    expect(otpHit, 'expected supabase /auth/v1/otp to be called').toBe(true);
    expect(otpBody).toMatchObject({ email: 'e2e@example.com' });
  });

  test('/api/auth/callback returns redirect when code missing', async ({ request }) => {
    const res = await request.get('/api/auth/callback', { maxRedirects: 0 });
    // Either redirect (3xx) or page renders with login_error in URL
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain('login_error=missing_code');
  });
});
