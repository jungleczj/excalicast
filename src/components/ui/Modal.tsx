'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 容器宽度（px）。默认 440。 */
  width?: number;
  /** 点遮罩是否关闭（流程类弹窗如录制设置传 false）。 */
  dismissable?: boolean;
  /** 隐藏右上角 ✕（自带关闭的弹窗用）。 */
  hideClose?: boolean;
  closeLabel?: string;
  /** 容器额外样式（极少用）。 */
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * 统一弹窗壳 —— 遮罩 + 容器 + ✕ 关闭钮，全站弹窗共用，确保遮罩/阴影/圆角/关闭钮一致。
 * 视觉由 Craft scope 覆盖为纸面、hairline、柔和阴影；内部内容原样传入。
 */
export function Modal({
  open,
  onClose,
  width = 440,
  dismissable = true,
  hideClose = false,
  closeLabel = 'close',
  style,
  children,
}: Props): JSX.Element | null {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="app-craft-modal-overlay fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'var(--overlay)', zIndex: 9999 }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="app-craft-modal-card relative max-w-[92vw]"
        style={{
          width,
          background: 'var(--paper)',
          border: '2px solid var(--ink)',
          borderRadius: 5,
          boxShadow: 'var(--hard-lg)',
          overflow: 'hidden',
          ...style,
        }}
      >
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            className="app-craft-modal-close absolute right-3 top-3 z-10 grid place-items-center"
            style={{
              width: 30,
              height: 30,
              border: '1.4px solid var(--ink)',
              background: 'var(--paper)',
              borderRadius: 3,
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
            aria-label={closeLabel}
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
