'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { isPaid, simulatePayment } from '@/services/paymentClient';
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

  if (!open) return null;

  const handleUnlock = async () => {
    setError(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/checkout/one-time', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordingId }),
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

  const handleDevSimulate = async () => {
    setError(null);
    setStatusMsg(t('simulating'));
    setBusy(true);
    try {
      await simulatePayment(recordingId);
      onPaid?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'simulate_failed');
    } finally {
      setBusy(false);
    }
  };

  const showDevLink = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-[460px] max-w-[92vw] rounded-2xl bg-bg-primary p-7 shadow-2xl"
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
          style={{ background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))' }}
        >
          <I.Lock size={28} />
        </div>
        <h2 className="text-[20px] font-bold leading-tight text-text-primary">{t('title')}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          {t.rich('subtitle', { strong: (chunks) => <strong className="text-text-primary">{chunks}</strong> })}
        </p>

        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[36px] font-bold leading-none text-text-primary">{priceLabel}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">{t('priceUnit')}</span>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {[t('bullet1'), t('bullet2'), t('bullet3'), provider === 'creem' ? t('bulletPaymentCreem') : t('bulletPaymentPaddle')].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <I.Check size={14} sw={2.5} className="mt-0.5 flex-shrink-0 text-success-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {(statusMsg || error) && (
          <div className="mt-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px]">
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
            onClick={() => void handleUnlock()}
            disabled={busy || (provider === 'paddle' && !paddle)}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'var(--accent-600)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}
          >
            <I.Lock size={14} />
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
            className="mt-3 w-full rounded-md border border-primary-600 bg-primary-50 px-4 py-2 text-[12px] font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-40"
          >
            {t('upgradeAlt', { price: proPriceLabel })}
          </button>
        )}

        {showDevLink && (
          <button
            onClick={handleDevSimulate}
            disabled={busy}
            className="mt-3 w-full text-center text-[10px] text-text-tertiary underline hover:text-text-secondary disabled:opacity-40"
          >
            {t('devSkip')}
          </button>
        )}

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          {t('footer')}
        </p>
      </div>
    </div>
  );
}
