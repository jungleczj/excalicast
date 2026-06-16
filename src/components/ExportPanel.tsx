'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { trackEvent } from '@/lib/analytics/track';
import { exportRecording, downloadBlob } from '@/services/exportPipeline';
import { isPaid } from '@/services/paymentClient';
import { uploadRecording } from '@/services/cloudSync';
import { I } from '@/components/icons';
import { PaywallModal } from '@/components/PaywallModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { SubtitlePanel } from '@/components/SubtitlePanel';
import { HandoutPanel } from '@/components/HandoutPanel';
import { ShareLinkModal } from '@/components/ShareLinkModal';
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
  /** 是否显示「进阶（字幕/讲义/分享）」捆绑区块。编辑器把这些拆到独立 Tab 时传 false。 */
  showAdvanced?: boolean;
}

export function ExportPanel({ recordingId, config, onConfigChange, onPaidStateChange, onProgress, showAdvanced = true }: Props): JSX.Element {
  const t = useTranslations('exportPanel');
  const subscription = useSubscription();
  const [paid, setPaid] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [paywallOpen, setPaywallOpen] = useState<boolean>(false);
  const [proUpgradeOpen, setProUpgradeOpen] = useState<boolean>(false);
  const [upgradeTier, setUpgradeTier] = useState<'pro' | 'max'>('pro');
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState<boolean>(false);
  const [pendingExport, setPendingExport] = useState<boolean>(false);
  const [bgPolling, setBgPolling] = useState<boolean>(false);
  // Max-only: handout + share
  const [handoutOpen, setHandoutOpen] = useState<boolean>(false);
  const [shareBusy, setShareBusy] = useState<boolean>(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<number>(0);
  const [shareModalOpen, setShareModalOpen] = useState<boolean>(false);
  const [maxFeatureMsg, setMaxFeatureMsg] = useState<string | null>(null);
  const [shareNeedsCloud, setShareNeedsCloud] = useState<boolean>(false);
  const [savingCloud, setSavingCloud] = useState<boolean>(false);

  const maxUnlocked = subscription.permissions.handout && subscription.permissions.shareLink;

  const openUpgrade = useCallback((tier: 'pro' | 'max') => {
    setUpgradeTier(tier);
    setProUpgradeOpen(true);
  }, []);

  const handleCreateShareLink = useCallback(async () => {
    setShareBusy(true);
    setMaxFeatureMsg(null);
    try {
      const res = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; expiresAt?: number; error?: string; message?: string };
      if (!res.ok || !j.url) {
        if (j.error === 'cloud_recording_required') {
          setShareNeedsCloud(true);
          setMaxFeatureMsg(j.message ?? 'cloud required');
        } else {
          setMaxFeatureMsg(j.message ?? j.error ?? `share ${res.status}`);
        }
        return;
      }
      setShareNeedsCloud(false);
      setShareUrl(j.url);
      setShareExpiresAt(j.expiresAt ?? 0);
      setShareModalOpen(true);
      trackEvent('share_create', { recordingId });
    } catch (err) {
      setMaxFeatureMsg(err instanceof Error ? err.message : 'unknown');
    } finally {
      setShareBusy(false);
    }
  }, [recordingId]);

  // 「保存到云端并重试」：就地上云后自动重试创建分享，免去回录制库
  const handleSaveCloudThenShare = useCallback(async () => {
    setSavingCloud(true);
    setMaxFeatureMsg(null);
    try {
      await uploadRecording(recordingId);
      setShareNeedsCloud(false);
      await handleCreateShareLink();
    } catch (err) {
      setMaxFeatureMsg(err instanceof Error ? err.message : 'upload_failed');
    } finally {
      setSavingCloud(false);
    }
  }, [recordingId, handleCreateShareLink]);

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
            meta={proUnlocked ? t('cleanMetaPro') : paid ? t('cleanMetaPaid') : t('cleanMetaLocked')}
            hint={proUnlocked ? t('cleanHintPro') : paid ? t('cleanHintPaid') : t('cleanHintLocked')}
            accent={!config.withWatermark}
          />
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 transition"
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
              {t('buttonUnlock')}
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

      {showAdvanced && (<>
      <div style={{ height: 1.5, background: 'var(--ink)', opacity: 0.4 }} />

      <div>
        <h3 className="mb-2 flex items-center gap-2 label-mono" style={{ fontSize: 11 }}>
          {t('advancedHeading')}
          {!proUnlocked && (
            <button
              type="button"
              onClick={() => openUpgrade('pro')}
              className="ml-auto btn-sketch btn-sketch-hi"
              style={{ padding: '5px 10px', fontSize: 10 }}
            >
              {t('upgradePro')}
            </button>
          )}
        </h3>
        <p className="mb-3" style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>{t('advancedLede')}</p>
        <div className="space-y-2">
          <BundleCard
            bandColor="var(--pro)"
            pill="PRO"
            headerIcon={<I.Sparkles size={16} />}
            title={t('proBundleTitle')}
            desc={t('proBundleDesc')}
            unlockLabel={t('proBundleUnlock')}
            unlocked={subscription.permissions.subtitle}
            onUpgrade={() => openUpgrade('pro')}
            rows={[
              {
                icon: <I.Subtitles size={14} />,
                action: {
                  title: t('subtitleTitle'),
                  desc: t('subtitleDesc'),
                  actionLabel: subscription.permissions.subtitle ? t('subtitleAction') : t('subtitleActionLocked'),
                  onAction: () => {
                    trackEvent('feature_click', { feature: 'subtitle', gated: !subscription.permissions.subtitle });
                    setSubtitlePanelOpen((v) => !v);
                  },
                },
              },
              {
                icon: <I.Cloud size={14} />,
                // 被动权益：无动作按钮（actionLabel 空）
                action: { title: t('cloudTemplateTitle'), desc: t('cloudTemplateDesc'), actionLabel: '', onAction: () => {} },
              },
            ]}
          />
          <BundleCard
            bandColor="var(--max)"
            pill="MAX"
            headerIcon={<I.Sparkles size={16} />}
            title={t('maxBundleTitle')}
            desc={t('maxBundleDesc')}
            unlockLabel={t('maxBundleUnlock')}
            unlocked={maxUnlocked}
            onUpgrade={() => openUpgrade('max')}
            rows={[
              {
                icon: <I.Sparkles size={14} />,
                action: {
                  title: t('handoutTitle'),
                  desc: t('handoutDesc'),
                  actionLabel: handoutOpen ? t('handoutTitle') : t('handoutGenerate'),
                  onAction: () => {
                    trackEvent('feature_click', { feature: 'handout', gated: !subscription.permissions.handout });
                    setHandoutOpen((v) => !v);
                  },
                },
              },
              {
                icon: <I.Share size={14} />,
                action: {
                  title: t('shareTitle'),
                  desc: t('shareDesc'),
                  actionLabel: shareBusy ? t('shareCreating') : t('shareCreate'),
                  onAction: () => {
                    trackEvent('feature_click', { feature: 'share', gated: !subscription.permissions.shareLink });
                    void handleCreateShareLink();
                  },
                  busy: shareBusy,
                },
              },
            ]}
          />
        </div>

        {maxUnlocked && handoutOpen && (
          <HandoutPanel recordingId={recordingId} config={config} />
        )}
        {maxFeatureMsg && (
          <div className="mt-3 space-y-2">
            <div
              className="px-3 py-2"
              style={{
                background: 'var(--rec-soft)',
                border: '1.4px solid var(--rec)',
                borderRadius: 3,
                fontSize: 12,
                color: 'var(--rec)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {maxFeatureMsg}
            </div>
            {shareNeedsCloud && (
              <button
                type="button"
                onClick={() => { void handleSaveCloudThenShare(); }}
                disabled={savingCloud}
                className="btn-sketch btn-sketch-primary w-full"
                style={{ justifyContent: 'center' }}
              >
                {savingCloud ? t('savingToCloud') : t('saveToCloudAndRetry')}
              </button>
            )}
          </div>
        )}
      </div>
      </>)}

      {shareUrl && (
        <ShareLinkModal
          open={shareModalOpen}
          url={shareUrl}
          expiresAt={shareExpiresAt}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {(statusMsg || error || bgPolling) && (
        <div
          className="p-3"
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
      className="flex w-full items-start gap-3 p-3 text-left transition"
      style={{
        background: selected ? (accent ? 'var(--hi)' : 'var(--hi-soft)') : 'var(--paper)',
        border: '1.4px solid var(--ink)',
        borderRadius: 3,
        boxShadow: selected ? '2px 2px 0 var(--ink)' : 'none',
      }}
    >
      <span
        className="mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full"
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

interface MaxBundleAction {
  title: string;
  desc: string;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
}

/**
 * 套件卡片（Pro / Max 共用）—— 头部色带（图标 + 标题 + 档位徽标 + 未解锁时升级锁按钮）
 * + 若干行（MaxBundleRow，行的 actionLabel 为空则不渲染按钮，用于被动权益）。
 */
function BundleCard({
  bandColor,
  pill,
  headerIcon,
  title,
  desc,
  unlockLabel,
  unlocked,
  onUpgrade,
  rows,
}: {
  bandColor: string;
  pill: string;
  headerIcon: React.ReactNode;
  title: string;
  desc: string;
  unlockLabel: string;
  unlocked: boolean;
  onUpgrade: () => void;
  rows: Array<{ icon: React.ReactNode; action: MaxBundleAction }>;
}): JSX.Element {
  return (
    <div style={{ background: 'var(--paper)', border: '1.4px solid var(--ink)', borderRadius: 3 }}>
      {/* Header band */}
      <div
        className="flex items-center gap-3 px-3 py-3"
        style={{ background: bandColor, borderBottom: '1.4px solid var(--ink)', borderTopLeftRadius: 3, borderTopRightRadius: 3 }}
      >
        <div
          className="grid h-8 w-8 flex-shrink-0 place-items-center"
          style={{ background: 'var(--paper)', border: '1.4px solid var(--ink)', borderRadius: 3, color: 'var(--ink)' }}
        >
          {headerIcon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
            <span
              style={{
                padding: '1px 6px', background: 'var(--paper)', border: '1px solid var(--ink)',
                borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', color: 'var(--ink)',
              }}
            >
              {pill}
            </span>
          </div>
          <div className="mt-0.5" style={{ fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.4 }}>{desc}</div>
        </div>
        {!unlocked && (
          <button
            type="button"
            onClick={onUpgrade}
            className="flex items-center gap-1"
            style={{
              padding: '5px 10px', background: 'var(--ink)', color: 'var(--paper)',
              border: '1.3px solid var(--ink)', borderRadius: 3, fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            <I.Lock size={10} />
            {unlockLabel}
          </button>
        )}
      </div>

      {rows.map((r, i) => (
        <Fragment key={i}>
          {i > 0 && <div style={{ height: 1, background: 'var(--rule-faint)' }} />}
          <MaxBundleRow icon={r.icon} action={r.action} unlocked={unlocked} onLockedClick={onUpgrade} />
        </Fragment>
      ))}
    </div>
  );
}

function MaxBundleRow({
  icon,
  action,
  unlocked,
  onLockedClick,
}: {
  icon: React.ReactNode;
  action: MaxBundleAction;
  unlocked: boolean;
  onLockedClick: () => void;
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5"
      style={{ opacity: unlocked ? 1 : 0.55 }}
    >
      <div
        className="grid h-6 w-6 flex-shrink-0 place-items-center"
        style={{
          background: 'var(--paper-2)',
          border: '1.2px solid var(--ink)',
          borderRadius: 3,
          color: 'var(--ink)',
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{action.title}</div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{action.desc}</div>
      </div>
      {action.actionLabel ? (
        <button
          type="button"
          onClick={() => (unlocked ? action.onAction() : onLockedClick())}
          disabled={action.busy}
          className="flex items-center gap-1"
          style={{
            padding: '4px 9px',
            background: unlocked ? 'var(--ink)' : 'var(--paper)',
            color: unlocked ? 'var(--paper)' : 'var(--ink)',
            border: '1.3px solid var(--ink)',
            borderRadius: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: action.busy ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          {!unlocked && <I.Lock size={10} />}
          {action.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Pro 套件卡片 —— 与 MaxBundleCard 同布局（头部色带 + 行）。
 * 行1 字幕（可点）；行2 跨设备云端保存模板（被动权益，无按钮）。
 */
