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
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-[480px] max-w-[92vw] rounded-2xl bg-bg-primary p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
          aria-label="close"
        >
          ✕
        </button>

        <div
          className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
        >
          <I.Sparkles size={28} />
        </div>
        <h2 className="text-[22px] font-bold leading-tight text-text-primary">{t('title')}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{t('subtitle')}</p>

        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[34px] font-bold leading-none text-text-primary">{priceLabel}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">
            {t('subscriptionTag', { provider: providerLabel, env: subscriptionEnvLabel })}
          </span>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {features.map((line) => <li key={line}>{line}</li>)}
        </ul>

        {(statusMsg || error || needLogin) && (
          <div className="mt-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px]">
            {needLogin && <div className="text-text-primary">{t('needLogin')}</div>}
            {statusMsg && <div className="text-text-primary">{statusMsg}</div>}
            {error && <div className="mt-1 text-recording-strong">{t('errorPrefix', { message: error })}</div>}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md border border-border-strong bg-bg-primary px-4 py-2.5 text-[13px] font-medium text-text-primary hover:bg-bg-tertiary disabled:opacity-40"
          >
            {t('ctaCancel')}
          </button>
          <button
            onClick={handleUpgrade}
            disabled={busy || (provider === 'paddle' && !paddle && !needLogin)}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 4px 12px rgba(59,130,246,0.35)' }}
          >
            <I.Sparkles size={14} />
            {needLogin
              ? t('loginFirst')
              : busy
                ? t('openingCheckout', { provider: providerLabel })
                : t('ctaUpgrade', { price: priceLabel })}
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
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
            className="mt-2 w-full rounded-md border border-dashed border-orange-400 bg-orange-50 px-3 py-2 text-[11px] font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-40"
          >
            {t('devGrant')}
          </button>
        )}
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
