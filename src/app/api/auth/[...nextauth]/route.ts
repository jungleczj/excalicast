import { handlers } from '@/auth';

// NextAuth.js v5 catch-all：处理 /api/auth/signin, /api/auth/callback/*, /api/auth/session, /api/auth/csrf 等。
// 不与既有的 /api/auth/{login,me,...} 冲突——Next.js 静态路由优先于 catch-all。
export const { GET, POST } = handlers;
