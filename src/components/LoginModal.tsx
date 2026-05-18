'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Login card (Supabase Auth magic-link mode, pure SDK — no self-hosted email flow):
 *   ┌──────────────────────────────────┐
 *   │  G  Continue with Google         │ ← only clickable when Supabase project has Google OAuth configured
 *   │     Enter your email             │
 *   │  ▣ Send magic link               │
 *   └──────────────────────────────────┘
 *
 * Email delivery, token persistence, and cookie refresh are all handled by Supabase Auth.
 * The client only calls supabase.auth.signInWithOtp once.
 */
export function LoginModal({ open, onClose }: Props): JSX.Element | null {
  const t = useTranslations('login');
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
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      setError(t('errorInvalidEmail'));
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
      setError(t('errorSendFail', { message: error.message }));
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
          aria-label="close"
        >
          ✕
        </button>

        <div className="px-7 pb-2 pt-9">
          <h2 className="text-[20px] font-semibold leading-tight text-[#181818]">{t('title')}</h2>
          <p className="mt-1 text-[12.5px] text-[#6b6b6b]">{t('subtitle')}</p>
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
            {t('google')}
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#e0ddd6]" />
            <span className="text-[11px] font-medium tracking-wider text-[#999]">{t('or')}</span>
            <div className="h-px flex-1 bg-[#e0ddd6]" />
          </div>

          {sentTo ? (
            <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
              <div className="text-[14px] font-semibold text-emerald-900">{t('sentTitle')}</div>
              <div className="mt-1 text-[12.5px] text-emerald-800">
                {t('sentSubtitle', { email: sentTo })}
              </div>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="mt-3 text-[11.5px] text-emerald-900 underline"
              >
                {t('changeEmail')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmail} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
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
                {busy === 'email' ? t('sending') : t('sendMagicLink')}
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
          {t('ackPrefix')}
          <Link href="/privacy" className="text-[#666] underline hover:text-[#181818]">{t('privacyLink')}</Link>
          {t('ackSuffix')}
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
