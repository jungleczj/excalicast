'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ProvidersInfo {
  google: boolean;
  email: boolean;
}

/**
 * 登录卡片（参考 Anthropic claude.ai 登录样式）：
 *   ┌──────────────────────────────────┐
 *   │  G  Continue with Google         │
 *   ├────────── OR ────────────────────│
 *   │  ┌─────────────────────────────┐ │
 *   │  │  Enter your email           │ │
 *   │  └─────────────────────────────┘ │
 *   │  ▣ Continue with email           │
 *   ├──────────────────────────────────┤
 *   │  By continuing, ...              │
 *   └──────────────────────────────────┘
 */
export function LoginModal({ open, onClose }: Props): JSX.Element | null {
  const [providers, setProviders] = useState<ProvidersInfo | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/auth/providers-info', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data: ProvidersInfo) => setProviders(data))
      .catch(() => setProviders({ google: false, email: false }));
  }, [open]);

  if (!open) return null;

  const handleGoogle = async () => {
    if (!providers?.google) return;
    setBusy('google');
    setError(null);
    try {
      await signIn('google', { callbackUrl: window.location.pathname });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'oauth_failed');
      setBusy(null);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('请输入合法邮箱');
      return;
    }
    if (!providers?.email) {
      setError('邮箱登录暂未启用');
      return;
    }
    setBusy('email');
    setError(null);
    const res = await signIn('email', {
      email: email.trim().toLowerCase(),
      redirect: false,
      callbackUrl: window.location.pathname,
    });
    setBusy(null);
    if (res?.error) {
      setError(`登录失败：${res.error}`);
      return;
    }
    onClose();
  };

  const noneEnabled = providers && !providers.google && !providers.email;

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
            登录账号以解锁未来 Pro / Max 功能。录制 + 单次购买无需登录。
          </p>
        </div>

        <div className="px-7 pb-6 pt-5">
          {!providers ? (
            <div className="py-6 text-center text-[12px] text-[#888]">加载中…</div>
          ) : (
            <>
              {/* Continue with Google */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy !== null || !providers.google}
                className="flex w-full items-center justify-center gap-3 rounded-[10px] border bg-white px-4 py-3 text-[14px] font-medium text-[#181818] transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: '#e0ddd6' }}
                title={providers.google ? '' : '未配置 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET'}
              >
                <GoogleIcon />
                Continue with Google
              </button>

              {/* OR divider */}
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#e0ddd6]" />
                <span className="text-[11px] font-medium tracking-wider text-[#999]">OR</span>
                <div className="h-px flex-1 bg-[#e0ddd6]" />
              </div>

              <form onSubmit={handleEmail} className="space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full rounded-[10px] border bg-white px-4 py-3 text-[14px] text-[#181818] outline-none transition placeholder:text-[#aaa] focus:border-[#181818]"
                  style={{ borderColor: '#e0ddd6' }}
                  disabled={busy !== null || !providers.email}
                />
                <button
                  type="submit"
                  disabled={busy !== null || !email || !providers.email}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: '#181818' }}
                  title={providers.email ? '' : '邮箱登录未启用：设 DEV_MODE=true 或 EMAIL_PASSWORDLESS=true'}
                >
                  ▣ Continue with email
                </button>
              </form>

              {noneEnabled && (
                <div className="mt-4 rounded-[8px] bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900" style={{ border: '1px solid #fde68a' }}>
                  还没有配置任何登录方式。在 <code className="font-mono text-[10.5px]">.env.local</code> 至少设一项：
                  <ul className="mt-1 ml-4 list-disc">
                    <li><code className="font-mono">AUTH_GOOGLE_ID</code> + <code className="font-mono">AUTH_GOOGLE_SECRET</code></li>
                    <li>或 <code className="font-mono">DEV_MODE=true</code> 启用邮箱直接登录</li>
                  </ul>
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#e0ddd6] px-7 py-3.5 text-[11px] text-[#888]">
          By continuing, you acknowledge Excalicast's{' '}
          <a href="#" className="text-[#666] underline hover:text-[#181818]">Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}

function GoogleIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
