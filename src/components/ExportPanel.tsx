'use client';

import { useCallback, useEffect, useState } from 'react';
import { exportRecording, downloadBlob } from '@/services/exportPipeline';
import { isPaid } from '@/services/paymentClient';
import { I } from '@/components/icons';
import { PaywallModal } from '@/components/PaywallModal';
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
  const [paid, setPaid] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [paywallOpen, setPaywallOpen] = useState<boolean>(false);
  // 用户点过 "渲染并下载（无水印）" 但因未付款被拦截。state（不是 ref）以便 effect 响应它。
  const [pendingExport, setPendingExport] = useState<boolean>(false);
  // 后台轮询是否正在跑，用来在 UI 上展示状态
  const [bgPolling, setBgPolling] = useState<boolean>(false);

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

  const handleExport = useCallback(async () => {
    if (!config.withWatermark && !paid) {
      setPendingExport(true);
      setPaywallOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    setStatusMsg(`正在生成 ${config.aspectRatio} ${config.withWatermark ? '含水印' : '无水印'} MP4…`);

    let lastPhase = '准备';
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
        // ffmpeg 日志不再展示在 UI 上，仅在 dev 控制台保留以便排查
        onLog: (m) => {
          if (process.env.NODE_ENV !== 'production') console.debug('[ffmpeg]', m);
        },
      });
      const ratioTag = config.aspectRatio.replace(':', 'x');
      const wmTag = config.withWatermark ? 'wm' : 'clean';
      downloadBlob(blob, `excalicast_${recordingId.slice(0, 8)}_${ratioTag}_${wmTag}.mp4`);
      setStatusMsg('导出完成，已开始下载。');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export_failed');
    } finally {
      setBusy(false);
      onProgress?.(null);
    }
  }, [config, recordingId, paid, onProgress]);

  // 付费成功后自动重启导出：上一次 handleExport 因 !paid 被拦截，pendingExport=true。
  // paid 翻 true 时（来自 PaywallModal 轮询、ExportPanel 后台轮询、或 dev mock），触发一次。
  useEffect(() => {
    if (paid && pendingExport) {
      setPendingExport(false);
      void handleExport();
    }
  }, [paid, pendingExport, handleExport]);

  // 后台轮询：modal 关闭后如果 pendingExport=true 且仍未 paid，继续每 3s 检查 /api/is-paid
  // 最多轮询 5 分钟，期间在 UI 上显示提示，paid 翻 true 后由上面的 effect 自动触发下载
  useEffect(() => {
    if (paid || !pendingExport || paywallOpen) {
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
        setStatusMsg('支付确认超时（5 分钟未收到 webhook），请刷新页面重试。');
        return;
      }
      void refreshPaid();
    }, intervalMs);
    return () => {
      clearInterval(id);
      setBgPolling(false);
    };
  }, [paid, pendingExport, paywallOpen, refreshPaid]);

  const isCleanLocked = !config.withWatermark && !paid;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-text-primary">导出 MP4</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
          全部本地渲染（ffmpeg.wasm），录制数据从不离开浏览器。
        </p>

        <RadioCard
          selected={config.withWatermark}
          onClick={() => onConfigChange({ ...config, withWatermark: true })}
          title="含水印导出"
          meta="免费 · 任何人"
          hint="右下角 Excalicast 品牌水印"
        />
        <div className="mt-2">
          <RadioCard
            selected={!config.withWatermark}
            onClick={() => onConfigChange({ ...config, withWatermark: false })}
            title="无水印导出"
            meta={paid ? '已购买 · 永久解锁' : '$3 · 单次购买'}
            hint={paid ? '本录制可任意比例反复导出无水印' : '点导出按钮即触发付费'}
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
              解锁并下载 · $3
            </>
          ) : (
            <>
              <I.Download size={16} />
              {config.withWatermark ? '渲染并下载（含水印）' : '渲染并下载（无水印）'}
            </>
          )}
        </button>

        {paid && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-success-600">
            <I.Check size={12} sw={2.5} /> 本录制已解锁，无水印导出不再额外付费
          </p>
        )}
      </div>

      <div className="border-t border-border-default" />

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-text-primary">AI 资产</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">把这次录制变成可复用的知识。</p>
        <div className="space-y-2">
          <FeatureRow icon={<I.Subtitles size={16} />} title="字幕（SRT + 嵌入）" desc="Whisper-1 · ~30s · 准确率 90%+" tier="Pro" />
          <FeatureRow icon={<I.Sparkles size={16} />} title="AI 讲义" desc="结构化 Markdown · 关键帧 + 文稿" tier="Max" highlight />
          <FeatureRow icon={<I.Share size={16} />} title="分享链接" desc="网页回放 · 30 天 TTL" tier="Max" highlight />
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
              <span>支付确认中…收到 webhook 后将自动开始下载，可关闭此页（最多等待 5 分钟）</span>
            </div>
          )}
          {statusMsg && !bgPolling && <div className="text-text-primary">{statusMsg}</div>}
          {error && <div className="mt-1 text-recording-strong">错误：{error}</div>}
        </div>
      )}

      <PaywallModal
        open={paywallOpen}
        recordingId={recordingId}
        onClose={() => setPaywallOpen(false)}
        onPaid={() => {
          setStatusMsg('已解锁，无水印模式已开启。');
          void refreshPaid();
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

function FeatureRow({ icon, title, desc, tier, highlight }: {
  icon: React.ReactNode; title: string; desc: string; tier: string; highlight?: boolean;
}): JSX.Element {
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
      <button
        disabled
        className="flex items-center gap-1 rounded border border-border-strong bg-bg-primary px-2.5 py-1 text-[11px] font-semibold text-text-primary opacity-60"
      >
        <I.Lock size={10} /> 升级
      </button>
    </div>
  );
}
