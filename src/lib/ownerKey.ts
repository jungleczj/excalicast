'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * 本地录制库归属键（ownerKey）：
 *  - 已登录：Supabase user.id
 *  - 匿名：每浏览器一个稳定 guestId（localStorage）
 * 用于把 IndexedDB 里的录制按用户隔离（同设备多账号互不可见）。
 */

const GUEST_KEY = 'excalicast_guest_id';
/** getSession 在 access token 临近/已过期时会发起一次网络刷新 token；弱网/断网下必须限时，否则录制启动会被挂起。 */
const OWNER_KEY_SESSION_TIMEOUT_MS = 2_000;

// 仅客户端调用（'use client'）。SSR/RSC 下不应触达此函数；fallback 仅为类型完整性。
export function getOrCreateGuestId(): string {
  if (typeof localStorage === 'undefined') return 'guest';
  let g = localStorage.getItem(GUEST_KEY);
  if (!g) {
    g = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(GUEST_KEY, g);
  }
  return g;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('owner_key_session_timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// 记住最近一次成功解析出的登录用户 id：getSession 因网络问题返回 null / 超时失败时，
// 优先沿用该 id，避免把登录用户的录制误归到 guest。
let lastResolvedUserId: string | null = null;

/** 异步取当前 ownerKey（录制落库时用）。
 *  注意：getSession 在本地无会话时立即返回；但 access token 临近/已过期时会走
 *  网络刷新 token —— 弱网/断网下可能长时间挂起，因此这里加超时兜底，绝不阻塞录制启动。 */
export async function getCurrentOwnerKey(): Promise<string> {
  try {
    const result = await withTimeout(createClient().auth.getSession(), OWNER_KEY_SESSION_TIMEOUT_MS);
    const userId = result?.data?.session?.user?.id;
    if (userId) {
      lastResolvedUserId = userId;
      return userId;
    }
    // 明确无会话（已登出/未登录）且无错误 → 清空缓存，回退 guest
    if (!result?.error) lastResolvedUserId = null;
  } catch {
    /* supabase 未配置 / 网络超时 → 保留缓存，走下方兜底 */
  }
  if (lastResolvedUserId) return lastResolvedUserId;
  return getOrCreateGuestId();
}
