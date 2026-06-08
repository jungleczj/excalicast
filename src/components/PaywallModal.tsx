'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { I } from '@/components/icons';
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
        window.open(j.redirectUrl, '_blank', 'noopener,noreferrer');
        setStatusMsg(t('creemRedirected'));
        void pollUntilPaid();
        return;
      }
      if (!paddle) {
        setError(t('errorPaddleNotInit'));
        setBusy(false);
        return;
      }
      openCheckout({ paddle, recordingId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(26, 26, 26, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="relative max-w-[92vw]"
        style={{
          width: 480,
          background: 'var(--paper)',
          border: '2px solid var(--ink)',
          borderRadius: 5,
          boxShadow: '6px 6px 0 var(--ink)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band */}
        <div
          style={{
            padding: 24,
            background: 'var(--hi-soft)',
            borderBottom: '1.6px solid var(--ink)',
            position: 'relative',
          }}
        >
          <div className="flex items-start justify-between">
            <span className="tag-mono tag-mono-hi">ONE-TIME · {priceLabel}</span>
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
            <I.Lock size={26} sw={1.6} />
          </div>
          <h2
            style={{
              fontSize: 24,
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
            {t.rich('subtitle', { strong: (chunks) => <strong style={{ color: 'var(--ink)' }}>{chunks}</strong> })}
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
                fontSize: 38,
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
              style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
            >
              {t('priceUnit')}
            </span>
          </div>

          <ul className="mt-5 space-y-2.5" style={{ fontSize: 13, color: 'var(--ink)' }}>
            {[t('bullet1'), t('bullet2'), t('bullet3'), provider === 'creem' ? t('bulletPaymentCreem') : t('bulletPaymentPaddle')].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <I.Check size={14} sw={2.4} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--ok)' }} />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {(statusMsg || error) && (
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
              onClick={() => void handleUnlock()}
              disabled={busy || (provider === 'paddle' && !paddle)}
              className="btn-sketch btn-sketch-primary"
              style={{ flex: 1.5, justifyContent: 'center' }}
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
              className="btn-sketch btn-sketch-hi mt-3 w-full"
              style={{ justifyContent: 'center' }}
            >
              {t('upgradeAlt', { price: proPriceLabel })}
            </button>
          )}

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
            {t('footer')}
          </p>
        </div>
      </div>
    </div>
  );
}
