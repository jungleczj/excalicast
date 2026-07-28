'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { exportRecording, downloadBlob } from '@/services/exportPipeline';
import { isPaid } from '@/services/paymentClient';
import { I } from '@/components/icons';
import { PaywallModal } from '@/components/PaywallModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { useSubscription } from '@/hooks/useSubscription';
import { formatPrice, usePaymentConfig } from '@/hooks/usePaymentConfig';
import { ProBadge } from '@/components/ProBadge';
import type { ExportConfig } from '@/types/recording';

export interface ExportProgressState {
  phase: string;
  ratio: number;
}

interface Props {
  recordingId: string;
  config: ExportConfig;
  onConfigChange: (next: ExportConfig) => void;
  onPaidStateChange?: (paid: boolean) => void;
  onProgress?: (state: ExportProgressState | null) => void;
}

export function ExportPanel({ recordingId, config, onConfigChange, onPaidStateChange, onProgress }: Props): JSX.Element {
  const t = useTranslations('exportPanel');
  const subscription = useSubscription();
  const { config: paymentCfg } = usePaymentConfig();
  const [paid, setPaid] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [paywallOpen, setPaywallOpen] = useState<boolean>(false);
  const [proUpgradeOpen, setProUpgradeOpen] = useState<boolean>(false);
  const [upgradeTier, setUpgradeTier] = useState<'pro' | 'max'>('pro');
  const [pendingExport, setPendingExport] = useState<boolean>(false);
  const [bgPolling, setBgPolling] = useState<boolean>(false);

  const openUpgrade = useCallback((tier: 'pro' | 'max') => {
    setUpgradeTier(tier);
    setProUpgradeOpen(true);
  }, []);

  const proUnlocked = subscription.permissions.exportWithoutWatermark;
  const effectivelyUnlocked = paid || proUnlocked;
  const oneTimePriceLabel = paymentCfg
    ? formatPrice(paymentCfg.oneTimePriceCents, paymentCfg.currency)
    : '…';

  const refreshPaid = useCallback(async () => {
    try {
      const r = await isPaid(recordingId);
      setPaid(r);
      onPaidStateChange?.(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'is_paid_failed');
    }
  }, [recordingId, onPaidStateChange]);

  useEffect(() => { void refreshPaid(); }, [refreshPaid]);

  useEffect(() => {
    if (proUnlocked) onPaidStateChange?.(true);
  }, [proUnlocked, onPaidStateChange]);

  const handleExport = useCallback(async () => {
    trackEvent('feature_click', { feature: 'export', gated: !config.withWatermark && !effectivelyUnlocked });
    if (!config.withWatermark && !effectivelyUnlocked) {
      setPendingExport(true);
      setPaywallOpen(true);
      return;
    }
    setBusy(true);
    setError(null);

    // 多选导出：逐个比例生成并依次下载（分辨率/格式/画质统一套用）。
    const ratios = (config.exportRatios && config.exportRatios.length > 0) ? config.exportRatios : [config.aspectRatio];
    const wmTag = config.withWatermark ? 'wm' : 'clean';
    const ext = config.format ?? 'mp4'; // mp4 / webm / gif

    let lastPhase = 'preparing';
    let lastRatio = 0;
    onProgress?.({ phase: lastPhase, ratio: 0 });

    try {
      for (let i = 0; i < ratios.length; i++) {
        const ar = ratios[i];
        setStatusMsg(ratios.length > 1
          ? t('exportingStatus', { ratio: `${ar} (${i + 1}/${ratios.length})`, wm: config.withWatermark ? t('wmWithLabel') : t('wmCleanLabel') })
          : t('exportingStatus', { ratio: ar, wm: config.withWatermark ? t('wmWithLabel') : t('wmCleanLabel') }));
        lastPhase = 'preparing'; lastRatio = 0;
        const blob = await exportRecording({
          ...config,
          aspectRatio: ar,
          // cropWindow/customOutput 只对其对应的（主）比例有效；其它比例用该比例的默认居中裁切。
          cropWindow: ar === config.aspectRatio ? config.cropWindow : undefined,
          customOutput: ar === config.aspectRatio ? config.customOutput : undefined,
          recordingId,
          onPhase: (p) => { lastPhase = p; onProgress?.({ phase: p, ratio: lastRatio }); },
          onProgress: (r) => { lastRatio = Math.min(1, Math.max(0, r)); onProgress?.({ phase: lastPhase, ratio: lastRatio }); },
          onLog: (m) => { if (process.env.NODE_ENV !== 'production') console.debug('[ffmpeg]', m); },
        });
        downloadBlob(blob, `excalicast_${recordingId.slice(0, 8)}_${ar.replace(':', 'x')}_${wmTag}.${ext}`);
        trackEvent('export_success', { ratio: ar, watermark: config.withWatermark });
      }
      setStatusMsg(t('doneStatus'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export_failed');
    } finally {
      setBusy(false);
      onProgress?.(null);
    }
  }, [config, recordingId, effectivelyUnlocked, onProgress, t]);

  useEffect(() => {
    if (effectivelyUnlocked && pendingExport) {
      setPendingExport(false);
      void handleExport();
    }
  }, [effectivelyUnlocked, pendingExport, handleExport]);

  useEffect(() => {
    if (effectivelyUnlocked || !pendingExport || paywallOpen) {
      setBgPolling(false);
      return;
    }
    setBgPolling(true);
    const startedAt = Date.now();
    const intervalMs = 3000;
    const timeoutMs = 5 * 60 * 1000;
    const id = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(id);
        setBgPolling(false);
        setPendingExport(false);
        setStatusMsg(t('bgTimeout'));
        return;
      }
      void refreshPaid();
    }, intervalMs);
    return () => {
      clearInterval(id);
      setBgPolling(false);
    };
  }, [effectivelyUnlocked, pendingExport, paywallOpen, refreshPaid, t]);

  const isCleanLocked = !config.withWatermark && !effectivelyUnlocked;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="label-mono mb-2" style={{ fontSize: 11 }}>{t('title')}</h3>
        <p className="mb-3" style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{t('lede')}</p>

        <RadioCard
          selected={config.withWatermark}
          onClick={() => onConfigChange({ ...config, withWatermark: true })}
          title={t('withWatermarkTitle')}
          meta={t('withWatermarkMeta')}
          hint={t('withWatermarkHint')}
        />
        <div className="mt-2">
          <RadioCard
            selected={!config.withWatermark}
            onClick={() => onConfigChange({ ...config, withWatermark: false })}
            title={t('cleanTitle')}
            meta={proUnlocked ? t('cleanMetaPro') : paid ? t('cleanMetaPaid') : t('cleanMetaLocked', { price: oneTimePriceLabel })}
            hint={proUnlocked ? t('cleanHintPro') : paid ? t('cleanHintPaid') : t('cleanHintLocked')}
            accent={!config.withWatermark}
          />
        </div>

        {config.localizedTrackId && config.muteOriginalAudio !== false && (
          <div
            data-testid="export-panel-localized-note"
            className="mt-3 flex items-start gap-2 px-3 py-2.5"
            style={{
              background: 'var(--paper-2)',
              border: '1px solid rgba(24,25,26,.10)',
              borderRadius: 18,
              color: 'var(--ink-2)',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            <I.Sparkles size={14} />
            <span>English dubbed audio will replace the original voice in preview and export.</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="editor-craft-export-button mt-4 flex w-full items-center justify-center gap-2 transition"
          style={{
            padding: '14px 18px',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: '1.6px solid var(--ink)',
            boxShadow: '4px 4px 0 var(--hi)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}
        >
          {isCleanLocked ? (
            <>
              <I.Lock size={14} />
              {t('buttonUnlock', { price: oneTimePriceLabel })}
            </>
          ) : (
            <>
              <I.Download size={14} />
              {config.withWatermark ? t('buttonWithWatermark') : t('buttonClean')}
            </>
          )}
        </button>

        {(paid || proUnlocked) && (
          <p
            className="mt-3 flex items-center justify-center gap-1.5"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ok)', letterSpacing: '0.04em' }}
          >
            <I.Check size={12} sw={2.5} />
            {proUnlocked ? (
              <span className="flex items-center gap-1">
                <ProBadge tier={subscription.tier} /> {t('unlockedProNote')}
              </span>
            ) : (
              t('unlockedPaidNote')
            )}
          </p>
        )}
      </div>

      {(statusMsg || error || bgPolling) && (
        <div
          className="editor-craft-panel-message p-3"
          style={{
            background: 'var(--paper-2)',
            border: '1.4px solid var(--ink)',
            borderRadius: 3,
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {bgPolling && (
            <div className="flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <span
                className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full"
                style={{ border: '2px solid var(--rule-soft)', borderTopColor: 'var(--ink)' }}
                aria-hidden
              />
              <span>{t('bgPolling')}</span>
            </div>
          )}
          {statusMsg && !bgPolling && <div style={{ color: 'var(--ink)' }}>{statusMsg}</div>}
          {error && <div className="mt-1" style={{ color: 'var(--rec)' }}>{t('errorPrefix', { message: error })}</div>}
        </div>
      )}

      <PaywallModal
        open={paywallOpen}
        recordingId={recordingId}
        onClose={() => setPaywallOpen(false)}
        onPaid={() => {
          setStatusMsg(t('paywallPaidStatus'));
          void refreshPaid();
        }}
        onUpgradePro={() => {
          setPaywallOpen(false);
          openUpgrade('pro');
        }}
      />
      <ProUpgradeModal
        open={proUpgradeOpen}
        tier={upgradeTier}
        onClose={() => setProUpgradeOpen(false)}
        onUpgraded={() => {
          setStatusMsg(t('proActivatedStatus'));
          void subscription.refresh();
        }}
      />
    </div>
  );
}

interface RadioCardProps {
  selected: boolean;
  onClick: () => void;
  title: string;
  meta: string;
  hint: string;
  accent?: boolean;
}

function RadioCard({ selected, onClick, title, meta, hint, accent }: RadioCardProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="editor-craft-radio flex w-full items-start gap-3 p-3 text-left transition"
      style={{
        background: selected ? (accent ? 'var(--hi)' : 'var(--hi-soft)') : 'var(--paper)',
        border: '1.4px solid var(--ink)',
        borderRadius: 3,
        boxShadow: selected ? '2px 2px 0 var(--ink)' : 'none',
      }}
    >
      <span
        className="editor-craft-radio-dot mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full"
        style={{ border: '1.6px solid var(--ink)', background: 'var(--paper)' }}
      >
        {selected && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--ink)' }} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.005em' }}>{title}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--ink-2)',
              textTransform: 'uppercase',
            }}
          >
            {meta}
          </span>
        </div>
        {hint && <div className="mt-1" style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
    </button>
  );
}
