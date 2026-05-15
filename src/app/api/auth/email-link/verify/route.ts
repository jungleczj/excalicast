import { NextResponse } from 'next/server';
import { verifyEmailLinkToken } from '@/lib/emailLinkJwt';
import { signIn } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Magic link landing page. User clicks the email link →
 *   - parse + verify the stateless JWT
 *   - hand it to the 'email-link' Credentials provider via server-side signIn
 *     so NextAuth sets the encrypted session cookie correctly
 *   - redirect to the original page
 */
export async function GET(req: Request): Promise<NextResponse | Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';

  if (!token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 });
  }

  const claims = await verifyEmailLinkToken(token);
  if (!claims) {
    // 失效或被篡改 → 把用户送回登录页（前端会再次弹 LoginModal）
    return NextResponse.redirect(new URL(`${safeNext}?login_error=link_invalid_or_expired`, req.url));
  }

  // 在 server-side 触发 NextAuth signIn，它会校验、建会话、set cookie 并执行重定向
  // 这里传 token 给 'email-link' Credentials provider 的 authorize()
  return signIn('email-link', {
    token,
    redirectTo: safeNext,
  }) as unknown as Response;
}
