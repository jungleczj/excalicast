'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { I } from '@/components/icons';
import { Modal } from '@/components/ui';
import { isPaid } from '@/services/paymentClient';
import { openCheckout, closeCheckout } from '@/services/paddleClient';
import { usePaddle } from '@/components/providers/PaddleProvider';
import { usePaymentConfig, formatPrice } from '@/hooks/usePaymentConfig';

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
  onPaid?: () => void;
  onUpgradePro?: () => void;
}

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 30;

export function PaywallModal({ open, recordingId, onClose, onPaid, onUpgradePro }: Props): JSX.Element | null {
  const t = useTranslations('paywall');
  const { paddle, subscribe } = usePaddle();
  const { config: paymentCfg } = usePaymentConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const provider = paymentCfg?.provider ?? 'paddle';
  const providerLabel = provider === 'creem' ? 'Creem' : 'Paddle';
  // Loading state: show "…" skeleton instead of a fake fallback price.
  const priceLabel = paymentCfg
    ? formatPrice(paymentCfg.oneTimePriceCents, paymentCfg.currency)
    : '…';
  const proPriceLabel = paymentCfg
    ? formatPrice(paymentCfg.proMonthlyPriceCents, paymentCfg.currency)
    : '…';

  useEffect(() => {
    if (open) trackEvent('upgrade_modal_open', { kind: 'one_time' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribe((event) => {
      if (event.name === 'checkout.completed') {
        setStatusMsg(t('checkoutCompleted'));
        if (paddle) closeCheckout(paddle);
        void pollUntilPaid();
      } else if (event.name === 'checkout.closed') {
        if (!pollingRef.current) {
          setBusy(false);
        }
      }
    });
    return unsubscribe;
  }, [open, paddle, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollUntilPaid = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          if (await isPaid(recordingId)) {
            trackEvent('purchase_success', { kind: 'one_time' });
            setStatusMsg(t('unlocked'));
            onPaid?.();
            onClose();
            return;
          }
        } catch {
          // transient — keep polling
        }
      }
      setStatusMsg(t('syncing'));
      onClose();
    } finally {
      pollingRef.current = false;
      setBusy(false);
    }
  };

  // Creem 在新标签页支付：用户付完切回本标签时立即重查入账，避免只靠定时轮询（可能超时）。
  useEffect(() => {
    if (!open) return;
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return;
      if (pollingRef.current) return; // 与轮询/自身共享互斥，避免 focus+visibility 并发双触发
      pollingRef.current = true;
      try {
        if (await isPaid(recordingId)) {
          trackEvent('purchase_success', { kind: 'one_time' });
          setStatusMsg(t('unlocked'));
          onPaid?.();
          onClose();
        }
      } catch { /* 未付/瞬时错误 → 忽略 */ } finally {
        pollingRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [open, recordingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleUnlock = async () => {
    setError(null);
    setStatusMsg(null);
    setBusy(true);
    // 关键：在用户点击的同步阶段先开好标签页，避免 await fetch 之后再 window.open 被弹窗拦截。
    const payWin = window.open('about:blank', '_blank');
    trackEvent('checkout_start', { kind: 'one_time' });
    try {
      const res = await fetch('/api/checkout/one-time', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // returnTo：支付成功后回到当前导出页 /zh/export/[id]，而不是落到 /app
        body: JSON.stringify({ recordingId, returnTo: window.location.pathname }),
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
        if (payWin && !payWin.closed) payWin.location.href = j.redirectUrl;
        else window.location.href = j.redirectUrl; // 预开标签被拦截 → 同标签跳转兜底
        setStatusMsg(t('creemRedirected'));
        void pollUntilPaid();
        return;
      }
      payWin?.close();
      if (!paddle) {
        setError(t('errorPaddleNotInit'));
        setBusy(false);
        return;
      }
      openCheckout({ paddle, recordingId });
    } catch (err) {
      payWin?.close();
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  return (
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
            <span className="commerce-craft-badge is-one-time">One-time · {priceLabel}</span>
            <div className="commerce-craft-icon is-one-time">
              <I.Lock size={28} sw={1.7} />
            </div>
            <h2 className="app-craft-modal-title commerce-craft-title">{t('title')}</h2>
            <p className="commerce-craft-subtitle">
              {t.rich('subtitle', { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>

          <div className="commerce-craft-body">
          <div className="commerce-craft-price-card">
            <span className="commerce-craft-price">{priceLabel}</span>
            <span className="commerce-craft-price-note">{t('priceUnit')}</span>
          </div>

          <ul className="commerce-craft-features">
            {[t('bullet1'), t('bullet2'), t('bullet3'), provider === 'creem' ? t('bulletPaymentCreem') : t('bulletPaymentPaddle')].map((line) => (
              <li key={line}>
                <span className="commerce-craft-check"><I.Check size={14} sw={2.2} /></span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {(statusMsg || error) && (
            <div className="commerce-craft-status">
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
              onClick={() => void handleUnlock()}
              disabled={busy || (provider === 'paddle' && !paddle)}
              className="app-craft-login commerce-craft-primary"
            >
              <I.Lock size={13} />
              {busy ? t('openingCheckout', { provider: providerLabel }) : t('ctaPay', { price: priceLabel })}
            </button>
          </div>

          {onUpgradePro && (
            <button
              onClick={() => {
                onClose();
                onUpgradePro();
              }}
              disabled={busy}
              className="app-craft-secondary-button commerce-craft-full"
            >
              {t('upgradeAlt', { price: proPriceLabel })}
            </button>
          )}

          <p className="commerce-craft-footnote">
            {t('footer')}
          </p>
        </div>
      </div>
    </Modal>
  );
}
