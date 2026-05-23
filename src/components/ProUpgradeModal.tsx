'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { LoginModal } from '@/components/LoginModal';
import { openProSubscriptionCheckout, closeCheckout } from '@/services/paddleClient';
import { usePaddle } from '@/components/providers/PaddleProvider';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { usePaymentConfig, formatPrice } from '@/hooks/usePaymentConfig';

interface Props {
  open: boolean;
  onClose: () => void;
  onUpgraded?: () => void;
}

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40;

export function ProUpgradeModal({ open, onClose, onUpgraded }: Props): JSX.Element | null {
  const t = useTranslations('proUpgrade');
  const { paddle, subscribe } = usePaddle();
  const { user, loading: authLoading } = useAuth();
  const { refresh: refreshTier } = useSubscription();
  const { config: paymentCfg } = usePaymentConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [resumeUpgradeAfterLogin, setResumeUpgradeAfterLogin] = useState(false);
  const pollingRef = useRef(false);

  const provider = paymentCfg?.provider ?? 'paddle';
  const providerLabel = provider === 'creem' ? 'Creem' : 'Paddle';
  const priceLabel = paymentCfg
    ? `${formatPrice(paymentCfg.proMonthlyPriceCents, paymentCfg.currency)}/mo`
    : '…';

  const pollUntilPro = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const r = await fetch('/api/me/tier', { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            if (j.tier === 'pro' || j.tier === 'max') {
              setStatusMsg(t('synced'));
              await refreshTier();
              onUpgraded?.();
              onClose();
              return;
            }
          }
        } catch {
          // transient
        }
      }
      setStatusMsg(t('syncing'));
      onClose();
    } finally {
      pollingRef.current = false;
      setBusy(false);
    }
  };

  const openPaddleCheckout = (u: { id: string; email: string }) => {
    if (!paddle) {
      setError(t('errorPaddleNotInit'));
      return;
    }
    setBusy(true);
    try {
      openProSubscriptionCheckout({ paddle, userId: u.id, email: u.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  const openCheckoutForProvider = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/checkout/pro', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        provider?: 'paddle' | 'creem';
        priceId?: string;
        redirectUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(j.message ?? j.error ?? `checkout ${res.status}`);
      if (j.provider === 'creem' && j.redirectUrl) {
        window.open(j.redirectUrl, '_blank', 'noopener,noreferrer');
        setStatusMsg(t('creemRedirected'));
        void pollUntilPro();
        return;
      }
      if (!user) {
        setError('unauthenticated');
        setBusy(false);
        return;
      }
      openPaddleCheckout(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribe((event) => {
      if (event.name === 'checkout.completed') {
        setStatusMsg(t('paymentDone'));
        if (paddle) closeCheckout(paddle);
        void pollUntilPro();
      } else if (event.name === 'checkout.closed') {
        if (!pollingRef.current) setBusy(false);
      }
    });
    return unsubscribe;
  }, [open, paddle, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    if (resumeUpgradeAfterLogin && user && !loginOpen) {
      setResumeUpgradeAfterLogin(false);
      void openCheckoutForProvider();
    }
  }, [open, resumeUpgradeAfterLogin, user, loginOpen, paddle, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const needLogin = !user && !authLoading;

  const handleUpgrade = () => {
    setError(null);
    setStatusMsg(null);
    if (!user) {
      setResumeUpgradeAfterLogin(true);
      setLoginOpen(true);
      return;
    }
    void openCheckoutForProvider();
  };

  const handleDevGrantPro = async () => {
    setError(null);
    setStatusMsg(null);
    if (!user) {
      setResumeUpgradeAfterLogin(true);
      setLoginOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/dev/grant-pro', { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `grant-pro failed: ${res.status}`);
      }
      setStatusMsg(t('devGranted'));
      await refreshTier();
      onUpgraded?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'dev_grant_failed');
    } finally {
      setBusy(false);
    }
  };

  const isPaddleSandbox = process.env.NEXT_PUBLIC_PADDLE_ENV === 'sandbox';
  const subscriptionEnvLabel = isPaddleSandbox ? t('sandbox') : t('secure');
  const features = t.raw('features') as string[];

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(26, 26, 26, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[92vw]"
        style={{
          width: 500,
          background: 'var(--paper)',
          border: '2px solid var(--ink)',
          borderRadius: 5,
          boxShadow: '6px 6px 0 var(--ink)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: 24,
            background: 'var(--pro)',
            borderBottom: '1.6px solid var(--ink)',
            position: 'relative',
          }}
        >
          <div className="flex items-start justify-between">
            <span className="tag-mono tag-mono-pro">PRO · {priceLabel}</span>
            <button
              onClick={onClose}
              className="grid place-items-center"
              style={{
                width: 30,
                height: 30,
                border: '1.4px solid var(--ink)',
                background: 'var(--paper)',
                borderRadius: 3,
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              aria-label="close"
            >
              <I.Close size={13} />
            </button>
          </div>

          <div
            className="mt-4 mb-4 grid h-14 w-14 place-items-center"
            style={{
              background: 'var(--paper)',
              border: '1.6px solid var(--ink)',
              borderRadius: 4,
              boxShadow: '3px 3px 0 var(--ink)',
              color: 'var(--ink)',
            }}
          >
            <I.Sparkles size={26} sw={1.6} />
          </div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              margin: 0,
              color: 'var(--ink)',
            }}
          >
            {t('title')}
          </h2>
        </div>

        <div className="p-6">
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
            {t('subtitle')}
          </p>

          <div
            className="mt-5 flex items-end gap-2 p-4"
            style={{
              background: 'var(--paper-2)',
              border: '1.4px solid var(--ink)',
              borderRadius: 3,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                color: 'var(--ink)',
                lineHeight: 1,
              }}
            >
              {priceLabel}
            </span>
            <span
              className="pb-1"
              style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
            >
              {t('subscriptionTag', { provider: providerLabel, env: subscriptionEnvLabel })}
            </span>
          </div>

          <ul className="mt-5 space-y-2.5" style={{ fontSize: 13, color: 'var(--ink)' }}>
            {features.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <I.Check size={14} sw={2.4} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--ok)' }} />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {(statusMsg || error || needLogin) && (
            <div
              className="mt-4 px-3 py-2"
              style={{
                background: 'var(--paper-2)',
                border: '1.4px solid var(--ink)',
                borderRadius: 3,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {needLogin && <div style={{ color: 'var(--ink)' }}>{t('needLogin')}</div>}
              {statusMsg && <div style={{ color: 'var(--ink)' }}>{statusMsg}</div>}
              {error && <div className="mt-1" style={{ color: 'var(--rec)' }}>{t('errorPrefix', { message: error })}</div>}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={onClose}
              disabled={busy}
              className="btn-sketch flex-1"
              style={{ justifyContent: 'center' }}
            >
              {t('ctaCancel')}
            </button>
            <button
              onClick={handleUpgrade}
              disabled={busy || (provider === 'paddle' && !paddle && !needLogin)}
              className="btn-sketch btn-sketch-primary"
              style={{ flex: 1.5, justifyContent: 'center' }}
            >
              <I.Sparkles size={14} />
              {needLogin
                ? t('loginFirst')
                : busy
                  ? t('openingCheckout', { provider: providerLabel })
                  : t('ctaUpgrade', { price: priceLabel })}
            </button>
          </div>

          <p
            className="mt-4 text-center"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {provider === 'creem'
              ? t('footnoteCreem')
              : isPaddleSandbox
                ? t('footnoteSandbox')
                : t('footnotePaddle')}
          </p>

          {process.env.NEXT_PUBLIC_DEV_MODE === 'true' && (
            <button
              type="button"
              onClick={() => void handleDevGrantPro()}
              disabled={busy}
              className="btn-sketch mt-3 w-full"
              style={{ justifyContent: 'center', borderStyle: 'dashed', fontSize: 10, padding: '8px 12px' }}
            >
              {t('devGrant')}
            </button>
          )}
        </div>
      </div>

      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          if (!user) setResumeUpgradeAfterLogin(false);
        }}
      />
    </div>
  );
}
