import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * E2E for the upgrade flow.
 *
 * Covered:
 *   1. Hook ordering regression — opening ProUpgradeModal no longer crashes
 *      with "Rendered more hooks than during the previous render".
 *   2. Clicking "先登录后再升级" really opens LoginModal (was a no-op).
 *   3. LoginModal exposes the production email magic-link path
 *      (no dev-mode wording, no dev-credentials provider).
 *   4. /api/auth/providers-info shape — no devCredentials field.
 *   5. /api/auth/email-link/send rejects without AUTH_RESEND_KEY,
 *      accepts when configured (skipped unless E2E_RESEND_ON=1 since
 *      we don't want to actually send mail in CI).
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

test.describe('ProUpgrade + LoginModal', () => {
  test('opening the upgrade modal does not crash with hook ordering errors', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await expect(page.getByText('升级 Pro', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByText('升级 Pro', { exact: true }).first().click();

    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);
    assertNoHookErrors(errors);
  });

  test('clicking "先登录后再升级" opens production LoginModal (no dev-mode wording)', async ({ page }) => {
    const { errors } = attachConsoleCollector(page);
    await page.goto('/app');
    await page.getByText('升级 Pro', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '升级到 Pro' })).toBeVisible({ timeout: 5_000 });

    const cta = page.getByRole('button', { name: /先登录后再升级/ });
    await expect(cta).toBeVisible();
    await cta.click();

    await expect(page.getByRole('heading', { name: '登录 Excalicast' })).toBeVisible({ timeout: 5_000 });

    // Production submit button — Magic link wording, NOT "直接登录（开发模式）"
    const submit = page.getByRole('button', { name: '发送登录链接到邮箱' });
    await expect(submit).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/开发模式/)).toHaveCount(0);
    await expect(page.getByText(/直接登录/)).toHaveCount(0);

    // 邮箱输入框存在且可输
    const emailInput = page.getByPlaceholder('Enter your email');
    await emailInput.fill('test@example.com');

    assertNoHookErrors(errors);
  });

  test('/api/auth/providers-info has no devCredentials field anymore', async ({ request }) => {
    const res = await request.get('/api/auth/providers-info');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('google');
    expect(body).toHaveProperty('email');
    expect(body).not.toHaveProperty('devCredentials');
  });

  test('/api/auth/email-link/send returns 503 when AUTH_RESEND_KEY missing, 200 when set', async ({ request }) => {
    const res = await request.post('/api/auth/email-link/send', {
      data: { email: 'test@example.com', callbackUrl: '/app' },
    });
    const hasResend = process.env.E2E_HAS_RESEND === '1';
    if (hasResend) {
      expect(res.status()).toBe(200);
      const j = await res.json();
      expect(j).toMatchObject({ ok: true });
    } else {
      // Without AUTH_RESEND_KEY we expect a clean 503 with our error code
      expect([503]).toContain(res.status());
      const j = await res.json();
      expect(j.error).toBe('resend_not_configured');
    }
  });

  test('/api/auth/email-link/send rejects invalid email', async ({ request }) => {
    const res = await request.post('/api/auth/email-link/send', {
      data: { email: 'not-an-email' },
    });
    // either 400 (invalid_email) when resend IS configured, or 503 (resend missing — checked first)
    expect([400, 503]).toContain(res.status());
  });
});
