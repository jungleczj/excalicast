'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';
import { openProSubscriptionCheckout, closeCheckout } from '@/services/paddleClient';
import { usePaddle } from '@/components/providers/PaddleProvider';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';

interface Props {
  open: boolean;
  onClose: () => void;
  onUpgraded?: () => void;
  onLoginRequest?: () => void;
}

const PRICE_LABEL = '$9 / 月';
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40;

const FEATURES = [
  '✅ 导出永久无水印（所有录制，不再单次付费）',
  '✅ 语音字幕生成（自动转 SRT 时间轴）',
  '✅ 云端备份录制（防丢失，多设备访问）',
  '✅ 优先客服支持',
];

export function ProUpgradeModal({ open, onClose, onUpgraded, onLoginRequest }: Props): JSX.Element | null {
  const { paddle, subscribe } = usePaddle();
  const { user, loading: authLoading } = useAuth();
  const { refresh: refreshTier } = useSubscription();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribe((event) => {
      if (event.name === 'checkout.completed') {
        setStatusMsg('支付完成，正在等待订阅生效…');
        if (paddle) closeCheckout(paddle);
        void pollUntilPro();
      } else if (event.name === 'checkout.closed') {
        if (!pollingRef.current) setBusy(false);
      }
    });
    return unsubscribe;
  }, [open, paddle, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

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
            if (j.tier === 'pro' || j.tier === 'max') {
              setStatusMsg('Pro 已开通！');
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
      setStatusMsg('订阅同步中，可关闭窗口稍后查看…');
      onClose();
    } finally {
      pollingRef.current = false;
      setBusy(false);
    }
  };

  if (!open) return null;

  const needLogin = !user && !authLoading;

  const handleUpgrade = () => {
    setError(null);
    setStatusMsg(null);
    if (!user) {
      onLoginRequest?.();
      return;
    }
    if (!paddle) {
      setError('Paddle 尚未初始化，请稍后重试或检查网络。');
      return;
    }
    setBusy(true);
    try {
      openProSubscriptionCheckout({ paddle, userId: user.id, email: user.email });
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
        className="relative w-[480px] max-w-[92vw] rounded-2xl bg-bg-primary p-7 shadow-2xl"
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
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
        >
          <I.Sparkles size={28} />
        </div>
        <h2 className="text-[22px] font-bold leading-tight text-text-primary">升级到 Pro</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          解锁全部高阶能力。订阅按月计费，可随时取消。
        </p>

        <div className="mt-5 flex items-end gap-2 rounded-xl border border-border-default bg-bg-secondary p-4">
          <span className="font-mono text-[34px] font-bold leading-none text-text-primary">{PRICE_LABEL}</span>
          <span className="pb-1 text-[12px] text-text-tertiary">订阅 · Paddle 沙盒可测</span>
        </div>

        <ul className="mt-4 space-y-2 text-[13px] text-text-secondary">
          {FEATURES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {(statusMsg || error || needLogin) && (
          <div className="mt-4 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-[12px]">
            {needLogin && <div className="text-text-primary">升级 Pro 需要先登录账户。</div>}
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
            暂不升级
          </button>
          <button
            onClick={handleUpgrade}
            disabled={busy || (!paddle && !needLogin)}
            className="flex flex-[2] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 4px 12px rgba(59,130,246,0.35)' }}
          >
            <I.Sparkles size={14} />
            {needLogin ? '先登录后再升级' : busy ? '正在打开 Paddle…' : `立即升级 · ${PRICE_LABEL}`}
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] text-text-tertiary">
          {process.env.NEXT_PUBLIC_PADDLE_ENV === 'sandbox'
            ? '当前为 Paddle 沙盒环境，可使用测试卡号支付'
            : 'Paddle 安全支付 · 随时取消'}
        </p>
      </div>
    </div>
  );
}
