'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
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
  tier?: 'pro' | 'max';
}

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40;

export function ProUpgradeModal({ open, onClose, onUpgraded, tier = 'pro' }: Props): JSX.Element | null {
  const isMax = tier === 'max';
  const t = useTranslations(isMax ? 'maxUpgrade' : 'proUpgrade');
  const { paddle, subscribe } = usePaddle();
  const { user, loading: authLoading } = useAuth();
  const { refresh: refreshTier } = useSubscription();
  const { config: paymentCfg } = usePaymentConfig();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [resumeUpgradeAfterLogin, setResumeUpgradeAfterLogin] = useState(false);
  const pollingRef = useRef(false);

  const provider = paymentCfg?.provider ?? 'paddle';
  const providerLabel = provider === 'creem' ? 'Creem' : 'Paddle';
  // 年付仅在两档年付 product 都配置好时可选；否则强制按月，不显示切换。
  const yearlyAvailable = !!paymentCfg?.yearlyAvailable;
  const effectiveBilling: 'monthly' | 'yearly' = yearlyAvailable ? billing : 'monthly';
  const monthlyCents = paymentCfg ? (isMax ? paymentCfg.maxMonthlyPriceCents : paymentCfg.proMonthlyPriceCents) : 0;
  const yearlyCents = paymentCfg ? (isMax ? paymentCfg.maxYearlyPriceCents : paymentCfg.proYearlyPriceCents) : 0;
  const priceLabel = paymentCfg
    ? (effectiveBilling === 'yearly'
        ? `${formatPrice(yearlyCents, paymentCfg.currency)}${t('perYear')}`
        : `${formatPrice(monthlyCents, paymentCfg.currency)}${t('perMonth')}`)
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
            if (isMax ? j.tier === 'max' : (j.tier === 'pro' || j.tier === 'max')) {
              trackEvent('purchase_success', { kind: 'subscription', tier });
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

  // 弹窗打开埋点（升级转化漏斗入口）
  useEffect(() => {
    if (open) trackEvent('upgrade_modal_open', { tier });
  }, [open, tier]);

  // Creem 在新标签页支付：付完切回本标签立即重查 tier，避免只靠定时轮询（可能超时）。
  // 订阅入账后只关弹窗回到已解锁面板——不自动执行任何功能。
  useEffect(() => {
    if (!open) return;
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return;
      if (pollingRef.current) return; // 与轮询/自身共享互斥，避免 focus+visibility 并发双触发
      pollingRef.current = true;
      try {
        const r = await fetch('/api/me/tier', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (isMax ? j.tier === 'max' : (j.tier === 'pro' || j.tier === 'max')) {
          trackEvent('purchase_success', { kind: 'subscription', tier });
          setStatusMsg(t('synced'));
          await refreshTier();
          onUpgraded?.();
          onClose();
        }
      } catch { /* 未入账/瞬时错误 → 忽略 */ } finally {
        pollingRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [open, isMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPaddleCheckout = (u: { id: string; email: string }) => {
    if (!paddle) {
      setError(t('errorPaddleNotInit'));
      return;
    }
    setBusy(true);
    try {
      openProSubscriptionCheckout({ paddle, userId: u.id, email: u.email, tier });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  const openCheckoutForProvider = async () => {
    setBusy(true);
    trackEvent('checkout_start', { kind: 'subscription', tier, billing: effectiveBilling });
    try {
      const res = await fetch('/api/checkout/pro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // returnTo：支付成功后回到当前页（如导出页 /zh/export/[id]）；在 /app 触发时自然回 /app
        body: JSON.stringify({ tier, billing: effectiveBilling, returnTo: window.location.pathname }),
      });
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
        className="pop-in relative max-w-[92vw]"
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
            background: isMax ? 'var(--max)' : 'var(--pro)',
            borderBottom: '1.6px solid var(--ink)',
            position: 'relative',
          }}
        >
          <div className="flex items-start justify-between">
            <span className={`tag-mono ${isMax ? 'tag-mono-max' : 'tag-mono-pro'}`}>{isMax ? 'MAX' : 'PRO'} · {priceLabel}</span>
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
            {isMax ? <I.Sparkles size={26} sw={1.6} /> : <I.Captions size={26} sw={1.6} />}
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

          {yearlyAvailable && (
            <div
              className="mt-5 flex items-center gap-1 p-1"
              style={{ background: 'var(--paper-2)', border: '1.4px solid var(--ink)', borderRadius: 3 }}
              role="tablist"
            >
              {(['monthly', 'yearly'] as const).map((b) => {
                const active = effectiveBilling === b;
                return (
                  <button
                    key={b}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBilling(b)}
                    className="press flex flex-1 items-center justify-center gap-1.5"
                    style={{
                      padding: '7px 10px',
                      borderRadius: 2,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: active ? '1.3px solid var(--ink)' : '1.3px solid transparent',
                      background: active ? 'var(--paper)' : 'transparent',
                      color: 'var(--ink)',
                      boxShadow: active ? '2px 2px 0 var(--ink)' : 'none',
                    }}
                  >
                    {b === 'monthly' ? t('billingMonthly') : t('billingYearly')}
                    {b === 'yearly' && (
                      <span
                        className="tag-mono tag-mono-pro"
                        style={{ fontSize: 9.5, padding: '1px 5px' }}
                      >
                        {t('saveBadge')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

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
