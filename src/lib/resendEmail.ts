/**
 * Server-side Resend client for magic link emails.
 * Single dependency: AUTH_RESEND_KEY (or RESEND_API_KEY).
 */

const DEFAULT_FROM = 'Excalicast <onboarding@resend.dev>';

export function isResendConfigured(): boolean {
  return !!(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY);
}

export async function sendMagicLinkEmail(params: {
  to: string;
  link: string;
}): Promise<void> {
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('resend_not_configured');
  const from = process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM;

  const host = (() => {
    try { return new URL(params.link).host; } catch { return 'Excalicast'; }
  })();

  const subject = `登录 ${host}`;
  const text = `点击以下链接完成登录（10 分钟内有效）：\n${params.link}\n\n如果不是你本人发起，请忽略本邮件。`;
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#faf8f3;padding:40px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;border:1px solid #e0ddd6;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#181818;">登录 Excalicast</h1>
    <p style="margin:0 0 24px;color:#6b6b6b;font-size:14px;line-height:1.5;">点击下面的按钮完成登录。链接 10 分钟内有效。</p>
    <a href="${params.link}" style="display:inline-block;background:#181818;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:500;">完成登录</a>
    <p style="margin:24px 0 0;color:#999;font-size:12px;line-height:1.5;">如果按钮无法点击，请复制以下链接到浏览器：<br/><span style="word-break:break-all;color:#666;">${params.link}</span></p>
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
    body: JSON.stringify({ from, to: params.to, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`resend_send_failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
