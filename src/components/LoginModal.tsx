'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Modal } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/icons';

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
    <Modal open={open} onClose={onClose} width={620}>
        <div
          className="app-craft-modal-header login-craft-header"
          style={{
            padding: '48px 54px 28px',
            background: 'var(--hi-soft)',
            borderBottom: '1.6px solid var(--ink)',
            position: 'relative',
          }}
        >
          <div className="login-craft-brand mx-auto flex items-center justify-center gap-3">
            <LogoMark size={56} />
            <span>Excalicast</span>
          </div>
          <div className="label-mono mt-8 text-center" style={{ fontSize: 10 }}>// SIGN IN</div>
          <h2
            className="app-craft-modal-title login-craft-title mt-2 text-center"
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}
          >
            {t('title')}
          </h2>
          <p className="login-craft-subtitle mx-auto mt-3 text-center" style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{t('subtitle')}</p>
        </div>

        <div className="login-craft-body px-7 pb-6 pt-6">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy !== null}
            className="app-craft-secondary-button login-craft-google flex w-full items-center justify-center gap-3"
            style={{
              padding: '12px 18px',
              background: 'var(--paper)',
              border: '1.5px solid var(--ink)',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              boxShadow: '2px 2px 0 var(--ink)',
            }}
          >
            <GoogleIcon />
            {t('google')}
          </button>

          <div className="login-craft-divider my-5 flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: 'var(--rule-soft)' }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              {t('or')}
            </span>
            <div className="h-px flex-1" style={{ background: 'var(--rule-soft)' }} />
          </div>

          {sentTo ? (
            <div
              className="app-craft-message px-4 py-4 text-center"
              style={{
                background: 'var(--hi-soft)',
                border: '1.4px solid var(--ink)',
                borderRadius: 3,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t('sentTitle')}</div>
              <div className="mt-1" style={{ fontSize: 12.5, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                {t('sentSubtitle', { email: sentTo })}
              </div>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="mt-3"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--ink)',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1.4px solid var(--ink)',
                  paddingBottom: 1,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
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
                className="app-craft-input login-craft-input w-full outline-none transition"
                style={{
                  padding: '12px 14px',
                  background: 'var(--paper)',
                  border: '1.5px solid var(--ink)',
                  borderRadius: 3,
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink)',
                }}
                disabled={busy !== null}
              />
              <button
                type="submit"
                disabled={busy !== null || !email}
                className="app-craft-login login-craft-submit w-full"
                style={{ justifyContent: 'center', padding: '13px 18px' }}
              >
                {busy === 'email' ? t('sending') : t('sendMagicLink')}
              </button>
            </form>
          )}

          {error && (
            <div
              className="app-craft-message library-craft-danger mt-3 px-3 py-2"
              style={{
                background: 'var(--rec-soft)',
                border: '1.4px solid var(--rec)',
                borderRadius: 3,
                fontSize: 12,
                color: 'var(--rec)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="app-craft-modal-footer login-craft-footer px-7 py-3.5"
          style={{
            borderTop: '1.5px solid var(--ink)',
            background: 'var(--paper-2)',
            fontSize: 11,
            color: 'var(--ink-3)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em',
          }}
        >
          {t('ackPrefix')}
          <Link
            href="/privacy"
            style={{ color: 'var(--ink)', borderBottom: '1.4px solid var(--hi)', textDecoration: 'none' }}
          >
            {t('privacyLink')}
          </Link>
          {t('ackSuffix')}
        </div>
    </Modal>
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
