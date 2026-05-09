import { Redis } from '@upstash/redis';

// Vercel Marketplace 装 Upstash Redis 后会自动注入两组兼容的 env：
//   - KV_REST_API_URL / KV_REST_API_TOKEN（Vercel 集成）
//   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（Upstash 原生）
// 任意一组存在即可。
function readUpstashEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
  if (!url || !token) return null;
  return { url, token };
}

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  const env = readUpstashEnv();
  if (!env) {
    throw new Error(
      'upstash_not_configured: 缺少 KV_REST_API_URL/KV_REST_API_TOKEN（或 UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN）',
    );
  }
  _redis = new Redis({ url: env.url, token: env.token });
  return _redis;
}

export function isUpstashConfigured(): boolean {
  return readUpstashEnv() !== null;
}
