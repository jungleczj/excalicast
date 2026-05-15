'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 登录卡片（Supabase Auth magic link 模式，纯 SDK，无自建邮件流程）：
 *   ┌──────────────────────────────────┐
 *   │  G  Continue with Google         │ ← 仅当 Supabase 项目已配 Google OAuth 时可点（这里始终显示，
 *   │     Enter your email             │     未配置时点击会跳到 Supabase 错误页）
 *   │  ▣ Send magic link               │
 *   └──────────────────────────────────┘
 *
 * 邮件发送、token 持久化、cookie 刷新 全部由 Supabase Auth 内置承担，
 * 客户端只调一次 supabase.auth.signInWithOtp。
 */
export function LoginModal({ open, onClose }: Props): JSX.Element | null {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!open) return null;

  const supabase = createClient();

  const handleGoogle = async () => {
    setBusy('google');
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
      },
    });
    if (error) {
      setError(error.message);
      setBusy(null);
    }
    // 否则浏览器会被 Supabase 重定向到 Google → 回调到 /api/auth/callback
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      setError('请输入合法邮箱');
      return;
    }
    setBusy('email');
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
      },
    });
    setBusy(null);
    if (error) {
      setError(`发送登录邮件失败：${error.message}`);
      return;
    }
    setSentTo(normalized);
  };

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[420px] max-w-[92vw] overflow-hidden rounded-[14px] shadow-2xl"
        style={{ background: '#faf8f3' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-[#666] hover:bg-black/5"
          aria-label="关闭"
        >
          ✕
        </button>

        <div className="px-7 pb-2 pt-9">
          <h2 className="text-[20px] font-semibold leading-tight text-[#181818]">登录 Excalicast</h2>
          <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
            登录账号以解锁 Pro 功能。录制 + 单次购买无需登录。
          </p>
        </div>

        <div className="px-7 pb-6 pt-5">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-3 rounded-[10px] border bg-white px-4 py-3 text-[14px] font-medium text-[#181818] transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#e0ddd6' }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#e0ddd6]" />
            <span className="text-[11px] font-medium tracking-wider text-[#999]">OR</span>
            <div className="h-px flex-1 bg-[#e0ddd6]" />
          </div>

          {sentTo ? (
            <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
              <div className="text-[14px] font-semibold text-emerald-900">登录邮件已发送</div>
              <div className="mt-1 text-[12.5px] text-emerald-800">
                请查收 <span className="font-mono">{sentTo}</span> 的收件箱
              </div>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="mt-3 text-[11.5px] text-emerald-900 underline"
              >
                换一个邮箱
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmail} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full rounded-[10px] border bg-white px-4 py-3 text-[14px] text-[#181818] outline-none transition placeholder:text-[#aaa] focus:border-[#181818]"
                style={{ borderColor: '#e0ddd6' }}
                disabled={busy !== null}
              />
              <button
                type="submit"
                disabled={busy !== null || !email}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#181818' }}
              >
                {busy === 'email' ? '发送中…' : '发送登录链接到邮箱'}
              </button>
            </form>
          )}

          {error && (
            <div className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-[#e0ddd6] px-7 py-3.5 text-[11px] text-[#888]">
          By continuing, you acknowledge Excalicast&apos;s{' '}
          <a href="/privacy" className="text-[#666] underline hover:text-[#181818]">Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}

function GoogleIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4" />
      <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="#34A853" />
      <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="#FBBC05" />
      <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" fill="#EA4335" />
    </svg>
  );
}
