'use client';

import { useState } from 'react';
import { I } from '@/components/icons';
import { startCheckout } from '@/services/paymentClient';

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
}

const PRICE_USD = '$3';

export function PaywallModal({ open, recordingId, onClose }: Props): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCheckout(recordingId);
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

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
          aria-label="关闭"
        >
          ✕
        </button>

        {/* 图标 + 标题 */}
        <div
          className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))' }}
        >
          <I.Lock size={28} />
        </div>
        <h2 className="text-[20px] font-bold leading-tight text-text-primary">解锁无水印导出</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          这条录制将<strong className="text-text-primary">永久解锁</strong>，可以任意比例 / 框选模式反复导出无水印 MP4。
          单次购买，<strong className="text-text-primary">无需注册账号</strong>。
        </p>

        {/* 价格区 */}
        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[36px] font-bold leading-none text-text-primary">{PRICE_USD}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">一次性 · 仅限本录制</span>
        </div>

        {/* 卖点列表 */}
        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {[
            '导出永久去除水印',
            '可反复导出 16:9 / 9:16 / 1:1 / 4:5 多个比例',
            '录制数据全程留在你浏览器，服务端只存付费状态',
            'Creem 安全支付（信用卡 / Apple Pay）',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <I.Check size={14} sw={2.5} className="mt-0.5 flex-shrink-0 text-success-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="mt-4 rounded-md border border-recording bg-recording/10 px-3 py-2 text-[12px] text-recording-strong">
            支付会话创建失败：{error}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md border border-border-strong bg-bg-primary px-4 py-2.5 text-[13px] font-medium text-text-primary hover:bg-bg-tertiary disabled:opacity-40"
          >
            暂不需要
          </button>
          <button
            onClick={handleUnlock}
            disabled={busy}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'var(--accent-600)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}
          >
            <I.Lock size={14} />
            {busy ? '正在跳转 Creem…' : `立即解锁 · ${PRICE_USD}`}
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          支付完成后自动返回，本页面会切换到无水印模式
        </p>
      </div>
    </div>
  );
}
