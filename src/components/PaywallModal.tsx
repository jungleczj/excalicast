'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';
import { isPaid, simulatePayment } from '@/services/paymentClient';
import { openCheckout, closeCheckout } from '@/services/paddleClient';
import { usePaddle } from '@/components/providers/PaddleProvider';

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
  onPaid?: () => void;
  onUpgradePro?: () => void;
}

const PRICE_USD = '$3';
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 30; // 30s 内大多数 webhook 都到了；之后由 ExportPanel 接管背景轮询

export function PaywallModal({ open, recordingId, onClose, onPaid, onUpgradePro }: Props): JSX.Element | null {
  const { paddle, subscribe } = usePaddle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribe((event) => {
      if (event.name === 'checkout.completed') {
        setStatusMsg('支付完成，正在确认…');
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
            setStatusMsg('已解锁！');
            onPaid?.();
            onClose();
            return;
          }
        } catch {
          // transient — keep polling
        }
      }
      // 30s 仍未拿到 paid → 关闭 modal，由 ExportPanel 在后台继续轮询
      setStatusMsg('支付确认中，正在后台等待，可关闭此窗口…');
      onClose();
    } finally {
      pollingRef.current = false;
      setBusy(false);
    }
  };

  if (!open) return null;

  const handleUnlock = () => {
    setError(null);
    setStatusMsg(null);
    if (!paddle) {
      setError('Paddle 尚未初始化，请稍后重试或检查网络。');
      return;
    }
    setBusy(true);
    try {
      openCheckout({ paddle, recordingId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  const handleDevSimulate = async () => {
    setError(null);
    setStatusMsg('正在模拟支付…');
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
          aria-label="关闭"
        >
          ✕
        </button>

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

        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[36px] font-bold leading-none text-text-primary">{PRICE_USD}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">一次性 · 仅限本录制</span>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {[
            '导出永久去除水印',
            '可反复导出 16:9 / 9:16 / 1:1 / 4:5 多个比例',
            '录制数据全程留在你浏览器，服务端只存付费状态',
            'Paddle 安全支付（信用卡 / Apple Pay / Google Pay）',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <I.Check size={14} sw={2.5} className="mt-0.5 flex-shrink-0 text-success-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {(statusMsg || error) && (
          <div className="mt-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px]">
            {statusMsg && <div className="text-text-primary">{statusMsg}</div>}
            {error && <div className="mt-1 text-recording-strong">错误：{error}</div>}
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
            disabled={busy || !paddle}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'var(--accent-600)', boxShadow: '0 4px 12px rgba(217,119,6,0.3)' }}
          >
            <I.Lock size={14} />
            {busy ? '正在打开 Paddle…' : `立即解锁 · ${PRICE_USD}`}
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
            或升级 Pro · $9/月 · 所有录制无水印 + 语音字幕 + 云备份
          </button>
        )}

        {showDevLink && (
          <button
            onClick={handleDevSimulate}
            disabled={busy}
            className="mt-3 w-full text-center text-[10px] text-text-tertiary underline hover:text-text-secondary disabled:opacity-40"
          >
            [dev] 跳过 Paddle，直接标记已付款
          </button>
        )}

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          支付完成后自动切换到无水印模式
        </p>
      </div>
    </div>
  );
}
