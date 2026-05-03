import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';

const isGoogleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const isEmailLoginEnabled = process.env.DEV_MODE === 'true' || process.env.EMAIL_PASSWORDLESS === 'true';

/**
 * NextAuth.js v5：
 *   - Google：填了 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET 即启用「Continue with Google」
 *   - Email：通过 Credentials provider 实现「Continue with email」直接登录
 *            v0.1 不发真实 magic link（避免依赖 SMTP/Resend）；
 *            生产环境应换成 NextAuth Email provider + Resend/SES 发送一次性链接
 *
 * 会话用 JWT 策略，无数据库适配器。
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.AUTH_SECRET ?? 'excalicast-dev-secret-change-me',
  providers: [
    ...(isGoogleConfigured ? [Google] : []),
    ...(isEmailLoginEnabled
      ? [
          Credentials({
            id: 'email',
            name: 'Email',
            credentials: {
              email: { label: 'Email', type: 'email' },
            },
            authorize: async (creds) => {
              const email = String(creds?.email ?? '').trim().toLowerCase();
              if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
              return {
                id: `email:${email}`,
                email,
                name: email.split('@')[0],
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
};
