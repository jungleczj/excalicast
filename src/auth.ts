import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import Credentials from 'next-auth/providers/credentials';
import type { EmailConfig } from 'next-auth/providers/email';
import { UpstashAdapter } from '@/lib/authAdapter';
import { isUpstashConfigured } from '@/lib/upstash';

const isGoogleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

// 邮箱（Magic Link）登录条件：必须有 token 存储（Upstash Redis）。
// dev 模式（DEV_MODE=true）下，没配 RESEND_API_KEY 时回落到 console.log 打印登录链接，
// 方便不申请 Resend 账号也能跑通流程。
const isUpstashOk = isUpstashConfigured();
const hasResendKey = Boolean(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY);
const isDevMode = process.env.DEV_MODE === 'true';
const isEmailLoginEnabled = isUpstashOk && (hasResendKey || isDevMode);

const EMAIL_FROM = process.env.AUTH_EMAIL_FROM || 'Excalicast <onboarding@resend.dev>';

/**
 * 自定义 sendVerificationRequest：
 *   - 有 RESEND key → 真实发邮件（沿用 Auth.js 默认实现里的 fetch 调用，但用我们自己的模板）
 *   - 没 key 且 DEV_MODE → console.log 链接
 */
async function sendVerificationRequest(params: Parameters<NonNullable<EmailConfig['sendVerificationRequest']>>[0]): Promise<void> {
  const { identifier: to, url } = params;
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY ?? '';

  if (!apiKey) {
    if (isDevMode) {
      // eslint-disable-next-line no-console
      console.log('\n========================================');
      // eslint-disable-next-line no-console
      console.log(`📧 [DEV] Magic link for ${to}:`);
      // eslint-disable-next-line no-console
      console.log(`   ${url}`);
      // eslint-disable-next-line no-console
      console.log('========================================\n');
      return;
    }
    throw new Error('resend_not_configured');
  }

  const { host } = new URL(url);
  const subject = `登录 ${host}`;
  const text = `你正在登录 Excalicast。\n\n点击以下链接完成登录（10 分钟内有效）：\n${url}\n\n如果不是你本人发起，请忽略本邮件。`;
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#faf8f3;padding:40px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;border:1px solid #e0ddd6;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#181818;">登录 Excalicast</h1>
    <p style="margin:0 0 24px;color:#6b6b6b;font-size:14px;line-height:1.5;">点击下面的按钮完成登录。链接 10 分钟内有效，仅可使用一次。</p>
    <a href="${url}" style="display:inline-block;background:#181818;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:500;">完成登录</a>
    <p style="margin:24px 0 0;color:#999;font-size:12px;line-height:1.5;">如果按钮无法点击，请复制以下链接到浏览器：<br/><span style="word-break:break-all;color:#666;">${url}</span></p>
    <hr style="border:none;border-top:1px solid #e0ddd6;margin:24px 0;" />
    <p style="margin:0;color:#999;font-size:11px;">如果不是你本人发起，请忽略本邮件，账号不会发生变更。</p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`resend_send_failed: ${res.status} ${errBody}`);
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.AUTH_SECRET ?? 'excalicast-dev-secret-change-me',
  // 只有 Upstash 已配（不然 token 没地方放），才挂 adapter
  adapter: isUpstashOk ? UpstashAdapter() : undefined,
  providers: [
    ...(isGoogleConfigured ? [Google] : []),
    ...(isEmailLoginEnabled
      ? [
          Resend({
            apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY ?? 'dev-noop',
            from: EMAIL_FROM,
            maxAge: 10 * 60, // magic link 10 分钟有效
            sendVerificationRequest,
          }),
        ]
      : []),
    // DEV_MODE 端侧快速登录：不需要 Upstash / Resend / Google 任何外部依赖。
    // 输入任意邮箱即建一个稳定 user（id = `dev-${email}`），JWT session 持有。
    // 严禁在生产启用：仅当 DEV_MODE === 'true' 时挂载。
    ...(isDevMode
      ? [
          Credentials({
            id: 'dev-credentials',
            name: 'Dev Login',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(credentials) {
              const raw = (credentials as { email?: unknown } | null)?.email;
              const email = String(raw ?? '').trim().toLowerCase();
              if (!email.includes('@')) return null;
              return {
                id: `dev-${email}`,
                email,
                name: email.split('@')[0] ?? email,
              };
            },
          }),
        ]
      : []),
  ],
  pages: {},
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = token.sub;
      }
      return session;
    },
  },
});

export const enabledProviders = {
  google: isGoogleConfigured,
  email: isEmailLoginEnabled,
  devCredentials: isDevMode,
};
