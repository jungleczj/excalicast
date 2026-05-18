'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { exportRecording, downloadBlob } from '@/services/exportPipeline';
import { isPaid } from '@/services/paymentClient';
import { I } from '@/components/icons';
import { PaywallModal } from '@/components/PaywallModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { SubtitlePanel } from '@/components/SubtitlePanel';
import { useSubscription } from '@/hooks/useSubscription';
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
  const [paid, setPaid] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [paywallOpen, setPaywallOpen] = useState<boolean>(false);
  const [proUpgradeOpen, setProUpgradeOpen] = useState<boolean>(false);
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState<boolean>(false);
  const [pendingExport, setPendingExport] = useState<boolean>(false);
  const [bgPolling, setBgPolling] = useState<boolean>(false);

  const proUnlocked = subscription.permissions.exportWithoutWatermark;
  const effectivelyUnlocked = paid || proUnlocked;

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
    if (!config.withWatermark && !effectivelyUnlocked) {
      setPendingExport(true);
      setPaywallOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    setStatusMsg(t('exportingStatus', {
      ratio: config.aspectRatio,
      wm: config.withWatermark ? t('wmWithLabel') : t('wmCleanLabel'),
    }));

    let lastPhase = 'preparing';
    let lastRatio = 0;
    onProgress?.({ phase: lastPhase, ratio: 0 });

    try {
      const blob = await exportRecording({
        ...config,
        recordingId,
        onPhase: (p) => {
          lastPhase = p;
          onProgress?.({ phase: p, ratio: lastRatio });
        },
        onProgress: (r) => {
          lastRatio = Math.min(1, Math.max(0, r));
          onProgress?.({ phase: lastPhase, ratio: lastRatio });
        },
        onLog: (m) => {
          if (process.env.NODE_ENV !== 'production') console.debug('[ffmpeg]', m);
        },
      });
      const ratioTag = config.aspectRatio.replace(':', 'x');
      const wmTag = config.withWatermark ? 'wm' : 'clean';
      downloadBlob(blob, `excalicast_${recordingId.slice(0, 8)}_${ratioTag}_${wmTag}.mp4`);
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
    <div className="space-y-3">
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-text-primary">{t('title')}</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">{t('lede')}</p>

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
            meta={proUnlocked ? t('cleanMetaPro') : paid ? t('cleanMetaPaid') : t('cleanMetaLocked')}
            hint={proUnlocked ? t('cleanHintPro') : paid ? t('cleanHintPaid') : t('cleanHintLocked')}
            accent={!config.withWatermark}
          />
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md transition disabled:opacity-40"
          style={
            isCleanLocked
              ? { background: 'var(--accent-600)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }
              : { background: 'var(--primary-600)', boxShadow: '0 1px 3px rgba(37,99,235,0.3)' }
          }
        >
          {isCleanLocked ? (
            <>
              <I.Lock size={16} />
              {t('buttonUnlock')}
            </>
          ) : (
            <>
              <I.Download size={16} />
              {config.withWatermark ? t('buttonWithWatermark') : t('buttonClean')}
            </>
          )}
        </button>

        {(paid || proUnlocked) && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-success-600">
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

      <div className="border-t border-border-default" />

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
          {t('advancedHeading')}
          {!proUnlocked && (
            <button
              type="button"
              onClick={() => setProUpgradeOpen(true)}
              className="ml-auto rounded-md px-2 py-1 text-[11px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
            >
              {t('upgradePro')}
            </button>
          )}
        </h3>
        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">{t('advancedLede')}</p>
        <div className="space-y-2">
          <FeatureRow
            icon={<I.Subtitles size={16} />}
            title={t('subtitleTitle')}
            desc={t('subtitleDesc')}
            tier="Pro"
            unlocked={subscription.permissions.subtitle}
            actionLabel={subscription.permissions.subtitle ? t('subtitleAction') : t('subtitleActionLocked')}
            onAction={() => {
              if (subscription.permissions.subtitle) setSubtitlePanelOpen(true);
              else setProUpgradeOpen(true);
            }}
            useLabel={t('use')}
            upgradeLabel={t('upgrade')}
          />
          <FeatureRow
            icon={<I.Sparkles size={16} />}
            title={t('handoutTitle')}
            desc={t('handoutDesc')}
            tier="Max"
            highlight
            unlocked={false}
            useLabel={t('use')}
            upgradeLabel={t('upgrade')}
          />
          <FeatureRow
            icon={<I.Share size={16} />}
            title={t('shareTitle')}
            desc={t('shareDesc')}
            tier="Max"
            highlight
            unlocked={false}
            useLabel={t('use')}
            upgradeLabel={t('upgrade')}
          />
        </div>
      </div>

      {(statusMsg || error || bgPolling) && (
        <div className="rounded-md border border-border-default bg-bg-secondary p-3 text-[12px]">
          {bgPolling && (
            <div className="flex items-center gap-2 text-primary-700">
              <span
                className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700"
                aria-hidden
              />
              <span>{t('bgPolling')}</span>
            </div>
          )}
          {statusMsg && !bgPolling && <div className="text-text-primary">{statusMsg}</div>}
          {error && <div className="mt-1 text-recording-strong">{t('errorPrefix', { message: error })}</div>}
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
          setProUpgradeOpen(true);
        }}
      />
      <ProUpgradeModal
        open={proUpgradeOpen}
        onClose={() => setProUpgradeOpen(false)}
        onUpgraded={() => {
          setStatusMsg(t('proActivatedStatus'));
          void subscription.refresh();
        }}
      />
      <SubtitlePanel
        open={subtitlePanelOpen}
        recordingId={recordingId}
        onClose={() => setSubtitlePanelOpen(false)}
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
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
      }`}
      style={{ borderWidth: selected ? 1.5 : 1 }}
    >
      <span
        className="mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full border-2"
        style={{ borderColor: selected ? 'var(--primary-600)' : 'var(--border-strong)' }}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-primary-600" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold text-text-primary">{title}</span>
          <span className={`text-[11px] font-semibold ${accent ? 'text-primary-700' : 'text-text-secondary'}`}>{meta}</span>
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
      </div>
    </button>
  );
}

function FeatureRow({ icon, title, desc, tier, highlight, unlocked, actionLabel, onAction, useLabel, upgradeLabel }: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tier: string;
  highlight?: boolean;
  unlocked: boolean;
  actionLabel?: string;
  onAction?: () => void;
  useLabel: string;
  upgradeLabel: string;
}): JSX.Element {
  const button = onAction ? (
    <button
      type="button"
      onClick={onAction}
      className="flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold"
      style={
        unlocked
          ? { background: 'var(--primary-600)', color: 'white', borderColor: 'var(--primary-600)' }
          : { background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }
      }
    >
      {!unlocked && <I.Lock size={10} />}
      {actionLabel ?? (unlocked ? useLabel : upgradeLabel)}
    </button>
  ) : (
    <button
      disabled
      className="flex items-center gap-1 rounded border border-border-strong bg-bg-primary px-2.5 py-1 text-[11px] font-semibold text-text-primary opacity-60"
    >
      <I.Lock size={10} /> {upgradeLabel}
    </button>
  );
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-default bg-bg-secondary px-3 py-2.5">
      <div
        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-text-tertiary"
        style={{
          background: highlight ? 'linear-gradient(135deg, #9333ea, #db2777)' : 'var(--primary-100)',
          color: highlight ? 'white' : 'var(--primary-700)',
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-semibold">{title}</span>
          <span
            className="rounded-full px-1.5 py-px text-[9px] font-bold tracking-wider text-white"
            style={{ background: tier === 'Max' ? 'linear-gradient(90deg, #9333ea, #db2777)' : 'var(--primary-600)' }}
          >
            {tier.toUpperCase()}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-text-secondary">{desc}</div>
      </div>
      {button}
    </div>
  );
}
