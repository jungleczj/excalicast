import type { Adapter, AdapterUser, AdapterAccount, VerificationToken } from '@auth/core/adapters';
import { randomUUID } from 'node:crypto';
import { getRedis } from '@/lib/upstash';

// 极简 Redis-backed Adapter，只实现 NextAuth Email/Resend + JWT session 必需的方法。
// Session 存 JWT cookie，所以 createSession/getSessionAndUser/... 不实现。
//
// Key 设计（前缀避免与业务数据冲突）：
//   auth:user:by-id:{userId}              → JSON AdapterUser
//   auth:user:by-email:{email}            → userId
//   auth:user:by-account:{provider}:{providerAccountId} → userId
//   auth:vt:{identifier}|{token}          → JSON VerificationToken（带 TTL 自动过期）

const K_USER_BY_ID = (id: string) => `auth:user:by-id:${id}`;
const K_USER_BY_EMAIL = (email: string) => `auth:user:by-email:${email.toLowerCase()}`;
const K_USER_BY_ACCOUNT = (provider: string, providerAccountId: string) =>
  `auth:user:by-account:${provider}:${providerAccountId}`;
const K_VT = (identifier: string, token: string) => `auth:vt:${identifier.toLowerCase()}|${token}`;

interface StoredUser {
  id: string;
  email: string;
  emailVerified: string | null; // ISO
  name?: string | null;
  image?: string | null;
}

function toAdapterUser(u: StoredUser): AdapterUser {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified ? new Date(u.emailVerified) : null,
    name: u.name ?? null,
    image: u.image ?? null,
  };
}

function fromAdapterUser(u: Partial<AdapterUser> & { id: string; email: string }): StoredUser {
  return {
    id: u.id,
    email: u.email.toLowerCase(),
    emailVerified: u.emailVerified ? new Date(u.emailVerified).toISOString() : null,
    name: u.name ?? null,
    image: u.image ?? null,
  };
}

export function UpstashAdapter(): Adapter {
  return {
    async createUser(user) {
      const redis = getRedis();
      const id = (user as Partial<AdapterUser>).id || randomUUID();
      const stored: StoredUser = fromAdapterUser({ ...(user as AdapterUser), id });
      await redis.set(K_USER_BY_ID(id), stored);
      await redis.set(K_USER_BY_EMAIL(stored.email), id);
      return toAdapterUser(stored);
    },

    async getUser(id) {
      const redis = getRedis();
      const u = await redis.get<StoredUser>(K_USER_BY_ID(id));
      return u ? toAdapterUser(u) : null;
    },

    async getUserByEmail(email) {
      const redis = getRedis();
      const id = await redis.get<string>(K_USER_BY_EMAIL(email));
      if (!id) return null;
      const u = await redis.get<StoredUser>(K_USER_BY_ID(id));
      return u ? toAdapterUser(u) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const redis = getRedis();
      const id = await redis.get<string>(K_USER_BY_ACCOUNT(provider, providerAccountId));
      if (!id) return null;
      const u = await redis.get<StoredUser>(K_USER_BY_ID(id));
      return u ? toAdapterUser(u) : null;
    },

    async updateUser(user) {
      const redis = getRedis();
      const existing = await redis.get<StoredUser>(K_USER_BY_ID(user.id));
      if (!existing) throw new Error(`user_not_found: ${user.id}`);
      const mergedUpdate: Partial<AdapterUser> & { id: string; email: string } = {
        id: user.id,
        email: user.email ?? existing.email,
        name: user.name ?? existing.name,
        image: user.image ?? existing.image,
        emailVerified:
          user.emailVerified !== undefined
            ? user.emailVerified
            : existing.emailVerified
              ? new Date(existing.emailVerified)
              : null,
      };
      const merged = fromAdapterUser(mergedUpdate);
      await redis.set(K_USER_BY_ID(merged.id), merged);
      if (existing.email !== merged.email) {
        await redis.del(K_USER_BY_EMAIL(existing.email));
        await redis.set(K_USER_BY_EMAIL(merged.email), merged.id);
      }
      return toAdapterUser(merged);
    },

    async linkAccount(account: AdapterAccount) {
      const redis = getRedis();
      await redis.set(K_USER_BY_ACCOUNT(account.provider, account.providerAccountId), account.userId);
      return undefined;
    },

    async createVerificationToken(vt: VerificationToken) {
      const redis = getRedis();
      const ttlSec = Math.max(60, Math.floor((vt.expires.getTime() - Date.now()) / 1000));
      await redis.set(
        K_VT(vt.identifier, vt.token),
        { identifier: vt.identifier, token: vt.token, expires: vt.expires.toISOString() },
        { ex: ttlSec },
      );
      return vt;
    },

    async useVerificationToken({ identifier, token }) {
      const redis = getRedis();
      const key = K_VT(identifier, token);
      const stored = await redis.get<{ identifier: string; token: string; expires: string }>(key);
      if (!stored) return null;
      await redis.del(key);
      return {
        identifier: stored.identifier,
        token: stored.token,
        expires: new Date(stored.expires),
      };
    },
  };
}
