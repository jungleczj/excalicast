'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * 本地录制库归属键（ownerKey）：
 *  - 已登录：Supabase user.id
 *  - 匿名：每浏览器一个稳定 guestId（localStorage）
 * 用于把 IndexedDB 里的录制按用户隔离（同设备多账号互不可见）。
 */

const GUEST_KEY = 'excalicast_guest_id';

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

/** 异步取当前 ownerKey（录制落库时用）。用 getSession（读本地存储、无网络），
 *  避免在录制启动这种热路径上阻塞，也不会因 getUser 的网络抖动误归 guest。 */
export async function getCurrentOwnerKey(): Promise<string> {
  try {
    const { data } = await createClient().auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
  } catch {
    /* supabase 未配置 / 无会话 → 回退 guest */
  }
  return getOrCreateGuestId();
}
