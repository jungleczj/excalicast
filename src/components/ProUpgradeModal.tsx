'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { I } from '@/components/icons';
import { Modal } from '@/components/ui';
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
              trackEvent('purchase_success', { kind: 'subscription', tier, payment_provider: provider });
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
          trackEvent('purchase_success', { kind: 'subscription', tier, payment_provider: provider });
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

  const openPaddleCheckout = (transactionId: string) => {
    if (!paddle) {
      setError(t('errorPaddleNotInit'));
      return;
    }
    setBusy(true);
    try {
      openProSubscriptionCheckout({ paddle, transactionId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  const openCheckoutForProvider = async () => {
    setBusy(true);
    // 关键：在用户点击的同步阶段先开好标签页，避免 await fetch 之后再 window.open 被弹窗拦截（→ 付款页唤不起）。
    const payWin = window.open('about:blank', '_blank');
    trackEvent('checkout_start', { kind: 'subscription', tier, billing: effectiveBilling, payment_provider: provider });
    try {
      const res = await fetch('/api/checkout/pro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // returnTo：支付成功后回到当前页（如导出页 /zh/export/[id]）；在 /app 触发时自然回 /app
        body: JSON.stringify({ tier, billing: effectiveBilling, returnTo: window.location.pathname }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        provider?: 'paddle' | 'creem';
        transactionId?: string;
        redirectUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(j.message ?? j.error ?? `checkout ${res.status}`);
      if (j.provider === 'creem' && j.redirectUrl) {
        if (payWin && !payWin.closed) payWin.location.href = j.redirectUrl;
        else window.location.href = j.redirectUrl; // 预开标签被拦截 → 同标签跳转兜底
        setStatusMsg(t('creemRedirected'));
        void pollUntilPro();
        return;
      }
      payWin?.close(); // 非 creem 路径（Paddle 内嵌等）：关掉预开的空标签
      if (!user) {
        setError('unauthenticated');
        setBusy(false);
        return;
      }
      if (!j.transactionId) throw new Error('paddle_transaction_missing');
      openPaddleCheckout(j.transactionId);
    } catch (err) {
      payWin?.close();
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
  const features = (t.raw('features') as string[]).map((line) => line.replace(/^✅\s*/, ''));

  return (
    <>
    <Modal open={open} onClose={onClose} width={620} hideClose>
        <div className="commerce-craft-modal">
          <button
            onClick={onClose}
            className="app-craft-modal-close commerce-craft-close grid place-items-center"
            aria-label="close"
          >
            <I.Close size={14} />
          </button>

          <div className="commerce-craft-header">
            <span className={`commerce-craft-badge ${isMax ? 'is-max' : 'is-pro'}`}>
              {isMax ? 'Max' : 'Pro'} · {priceLabel}
            </span>
            <div className={`commerce-craft-icon ${isMax ? 'is-max' : 'is-pro'}`}>
              {isMax ? <I.Sparkles size={28} sw={1.7} /> : <I.Captions size={28} sw={1.7} />}
            </div>
            <h2 className="app-craft-modal-title commerce-craft-title">{t('title')}</h2>
            <p className="commerce-craft-subtitle">{t('subtitle')}</p>
          </div>

          <div className="commerce-craft-body">

          {yearlyAvailable && (
            <div
              className="commerce-craft-billing"
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
                    className="press"
                    data-active={active}
                  >
                    {b === 'monthly' ? t('billingMonthly') : t('billingYearly')}
                    {b === 'yearly' && (
                      <span>{t('saveBadge')}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="commerce-craft-price-card">
            <span className="commerce-craft-price">{priceLabel}</span>
            <span className="commerce-craft-price-note">
              {t('subscriptionTag', { provider: providerLabel, env: subscriptionEnvLabel })}
            </span>
          </div>

          <ul className="commerce-craft-features">
            {features.map((line) => (
              <li key={line}>
                <span className="commerce-craft-check"><I.Check size={14} sw={2.2} /></span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {(statusMsg || error || needLogin) && (
            <div className="commerce-craft-status">
              {needLogin && <div>{t('needLogin')}</div>}
              {statusMsg && <div>{statusMsg}</div>}
              {error && <div className="commerce-craft-error">{t('errorPrefix', { message: error })}</div>}
            </div>
          )}

          <div className="app-craft-modal-actions commerce-craft-actions">
            <button
              onClick={onClose}
              disabled={busy}
              className="app-craft-secondary-button"
            >
              {t('ctaCancel')}
            </button>
            <button
              onClick={handleUpgrade}
              disabled={busy || (provider === 'paddle' && !paddle && !needLogin)}
              className="app-craft-login commerce-craft-primary"
            >
              <I.Sparkles size={14} />
              {needLogin
                ? t('loginFirst')
                : busy
                  ? t('openingCheckout', { provider: providerLabel })
                  : t('ctaUpgrade', { price: priceLabel })}
            </button>
          </div>

          <p className="commerce-craft-footnote">
            {provider === 'creem'
              ? t('footnoteCreem')
              : isPaddleSandbox
                ? t('footnoteSandbox')
                : t('footnotePaddle')}
          </p>
        </div>
      </div>
    </Modal>

      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          if (!user) setResumeUpgradeAfterLogin(false);
        }}
      />
    </>
  );
}
