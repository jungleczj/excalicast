'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingBar, type RecordingBarProps } from '@/components/RecordingBar';

// 以完整工具带的最大内容宽度为基准：状态、主操作、画幅及五个带标签的辅助工具
// 在英文下仍可单行显示，只留下 12px 左右的宿主呼吸空间。
const CONTROLS_WINDOW_SIZE = { width: 560, height: 64 } as const;
const DOCKED_CONTROLS_WINDOW_SIZE = { width: 72, height: 88 } as const;
const AUTO_DOCK_DELAY_MS = 1400;
const DOCK_AFTER_LEAVE_DELAY_MS = 380;

type DocumentPictureInPictureApi = {
  requestWindow: (options: {
    width: number;
    height: number;
    /** 隐去浏览器提供的「返回到标签页」控件，尽量减少 PiP 原生标题区。 */
    disallowReturnToOpener?: boolean;
    /** 重新打开时沿用用户上一次摆放的位置与尺寸。 */
    preferInitialWindowPlacement?: boolean;
  }) => Promise<Window>;
};

/**
 * Document Picture-in-Picture 是浏览器唯一能把完整录制控制条置于被采集页面以外的方式。
 * 样式表会一并复制到 PiP 文档，确保它和白板中的录制条是同一套组件与视觉。
 */
export async function requestDesktopRecordingControlsWindow(): Promise<Window | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
  // 顶层只承载控件本身：不再留出一个显性的“窗口卡片”背景。
  // Document PiP 的操作系统边缘不可由网页 CSS 移除；这里尽可能隐藏浏览器
  // 提供的返回控件，让用户只看到透明宿主中的录制控制带。
  // 不支持 Document PiP 时退到同源小窗口，而不是回退到会被捕获的页面内控制条。
  const host = api?.requestWindow
    ? await api.requestWindow({
        ...CONTROLS_WINDOW_SIZE,
        disallowReturnToOpener: true,
        preferInitialWindowPlacement: true,
      })
    : window.open(
        '',
        'excalicast-recording-controls',
        `popup=yes,width=${CONTROLS_WINDOW_SIZE.width},height=${CONTROLS_WINDOW_SIZE.height},resizable=yes`,
      ) ?? null;
  if (!host) return null;
  const doc = host.document;
  if (host !== window) {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      doc.head.appendChild(node.cloneNode(true));
    });
    // 空标题 + 透明文档底色，避免标题文字和白色页面底成为第二层“窗口”。
    // 原生窗口的边缘/阴影仍由浏览器和操作系统决定，无法由网页进一步覆盖。
    doc.title = '';
    doc.documentElement.style.cssText = 'background:transparent !important;color-scheme:dark;overflow:hidden;';
    doc.body.style.cssText = 'margin:0;width:100vw;height:100vh;overflow:hidden;background:transparent !important;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    doc.body.classList.add('desktop-recording-controls-pip');
  }
  return host;
}

interface Props {
  host: Window | null;
  bar: RecordingBarProps | null;
}

export function DesktopRecordingControls({ host, bar }: Props): JSX.Element | null {
  const isActive = !!host && !!bar && (bar.state === 'recording' || bar.state === 'paused');

  const [docked, setDocked] = useState(false);
  const leaveTimerRef = useRef<number | null>(null);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    clearLeaveTimer();
    setDocked(false);
  }, [clearLeaveTimer]);

  const scheduleDock = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      setDocked(true);
      leaveTimerRef.current = null;
    }, DOCK_AFTER_LEAVE_DELAY_MS);
  }, [clearLeaveTimer]);

  // 开录后不需要整段工具条长期遮在桌面/窗口上：先留一小段时间让用户确认状态，
  // 再收成可见的 REC 边签。鼠标回到边签即可恢复所有控制。
  useEffect(() => {
    if (!isActive) {
      setDocked(false);
      return;
    }
    setDocked(false);
    const timer = window.setTimeout(() => setDocked(true), AUTO_DOCK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      clearLeaveTimer();
    };
  }, [bar?.state, clearLeaveTimer, isActive]);

  // 普通 popup 可以真实缩小窗口；Document PiP 是否接受 resizeTo 取决于浏览器。
  // 即便浏览器拒绝缩窗，透明宿主内也只保留紧凑的边签，不显示完整工具带。
  useEffect(() => {
    if (!isActive || !host || host === window || host.closed) return;
    const next = docked ? DOCKED_CONTROLS_WINDOW_SIZE : CONTROLS_WINDOW_SIZE;
    try { host.resizeTo(next.width, next.height); } catch { /* Document PiP may not be resizable */ }
  }, [host, docked, isActive]);

  if (!isActive || !host || !bar) return null;

  return createPortal(
    <div
      data-testid="desktop-recording-controls"
      data-docked={docked ? 'true' : 'false'}
      className="rb-no-record"
      style={{
        display: 'grid',
        width: 'fit-content',
        height: 'fit-content',
        minWidth: 0,
        padding: 0,
        boxSizing: 'border-box',
        placeItems: 'center',
        justifySelf: docked ? 'end' : 'center',
        transition: 'opacity 160ms ease, transform 180ms cubic-bezier(.2,.8,.2,1)',
      }}
      onPointerEnter={reveal}
      onPointerLeave={scheduleDock}
    >
      {docked ? (
        <button
          type="button"
          data-testid="desktop-recording-controls-dock"
          onClick={reveal}
          aria-label="Show recording controls"
          aria-expanded="false"
          title="Show recording controls"
          style={{
            display: 'grid',
            placeItems: 'center',
            gap: 4,
            width: 60,
            height: 76,
            padding: '7px 8px 7px 10px',
            border: '1px solid rgba(255,255,255,.12)',
            borderRight: 'none',
            borderRadius: '18px 0 0 18px',
            background: 'rgba(18,19,20,.94)',
            color: '#fffdf8',
            boxShadow: '-10px 12px 28px rgba(20,22,24,.16), inset 0 1px 0 rgba(255,255,255,.10)',
            backdropFilter: 'blur(16px) saturate(1.1)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
            cursor: 'pointer',
          }}
        >
          <span className={bar.state === 'recording' ? 'recording-indicator' : ''} style={{ width: 8, height: 8, borderRadius: 999, background: bar.state === 'recording' ? 'var(--rec)' : 'rgba(255,255,255,.52)' }} />
          <span style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.04em' }}>{bar.state === 'recording' ? 'REC' : 'II'}</span>
          <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', opacity: .86 }}>{formatElapsed(bar.elapsedMs)}</span>
        </button>
      ) : <RecordingBar {...bar} />}
    </div>,
    host.document.body,
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
