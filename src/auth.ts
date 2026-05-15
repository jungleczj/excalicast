import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { isResendConfigured } from '@/lib/resendEmail';
import { verifyEmailLinkToken } from '@/lib/emailLinkJwt';

const isGoogleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

// 邮箱（Magic Link）登录：使用 stateless JWT magic link，**不**依赖 Upstash。
// 唯一外部依赖是 Resend（AUTH_RESEND_KEY）—— 用来发邮件。
// 见 src/lib/emailLinkJwt.ts 和 src/app/api/auth/email-link/*。
const isEmailLoginEnabled = isResendConfigured();

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.AUTH_SECRET ?? 'excalicast-dev-secret-change-me',
  providers: [
    ...(isGoogleConfigured ? [Google] : []),
    // 邮箱 Magic Link：客户端 POST /api/auth/email-link/send → Resend 发邮件 →
    // 用户点链接 → /api/auth/email-link/verify 解 JWT → server-side signIn('email-link', { token })
    // 这里 authorize 是最后一道闸：再次验 JWT，签发 NextAuth session。
    Credentials({
      id: 'email-link',
      name: 'Email link',
      credentials: { token: { label: 'Magic link token', type: 'text' } },
      async authorize(credentials) {
        const raw = (credentials as { token?: unknown } | null)?.token;
        const token = typeof raw === 'string' ? raw : '';
        if (!token) return null;
        const claims = await verifyEmailLinkToken(token);
        if (!claims) return null;
        return {
          id: `email-${claims.email}`,
          email: claims.email,
          name: claims.email.split('@')[0] ?? claims.email,
        };
      },
    }),
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
};
