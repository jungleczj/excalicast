import { NextResponse } from 'next/server';
import { signEmailLinkToken } from '@/lib/emailLinkJwt';
import { sendMagicLinkEmail, isResendConfigured } from '@/lib/resendEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  email?: string;
  callbackUrl?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isResendConfigured()) {
    return NextResponse.json(
      { error: 'resend_not_configured', message: '邮箱登录未配置：服务端缺少 AUTH_RESEND_KEY' },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email.includes('@') || email.length > 254) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // callbackUrl 只接受同站相对路径，防开放重定向
  const safeCallback =
    body.callbackUrl && body.callbackUrl.startsWith('/') && !body.callbackUrl.startsWith('//')
      ? body.callbackUrl
      : '/app';

  const token = await signEmailLinkToken(email);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const origin = appUrl || new URL(req.url).origin;
  const link = `${origin}/api/auth/email-link/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(safeCallback)}`;

  try {
    await sendMagicLinkEmail({ to: email, link });
  } catch (err) {
    return NextResponse.json(
      { error: 'send_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, to: email });
}
