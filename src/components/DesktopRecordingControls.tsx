'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RecordingBar, type RecordingBarProps } from '@/components/RecordingBar';

// 以完整工具带的最大内容宽度为基准：状态、主操作、画幅及五个带标签的辅助工具
// 在英文下仍可单行显示，只留下 12px 左右的宿主呼吸空间。
const CONTROLS_WINDOW_SIZE = { width: 560, height: 64 } as const;
const LEGACY_DOCKED_CONTROLS_WINDOW_SIZE = { width: 212, height: 56 } as const;
export const ADAPTIVE_DOCKED_CONTROLS_WINDOW_SIZE = { width: 196, height: 48 } as const;
const AUTO_DOCK_DELAY_MS = 1400;
const DOCK_AFTER_LEAVE_DELAY_MS = 380;
const HOST_RESIZE_STEPS = 6;
const HOST_RESIZE_STEP_MS = 28;

type ControlWindowSize = { width: number; height: number };
type ControlWindowMode = 'docked' | 'full';
type MeasuredControlWindow = { mode: ControlWindowMode; size: ControlWindowSize };

function getFullscreenCountdownWindowSize(): ControlWindowSize {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  const screenWidth = finitePositive(window.screen?.availWidth) ?? window.innerWidth;
  const screenHeight = finitePositive(window.screen?.availHeight) ?? window.innerHeight;
  return {
    width: Math.max(960, Math.round(screenWidth)),
    height: Math.max(640, Math.round(screenHeight)),
  };
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getOuterWindowTargetSize(host: Window, contentSize: ControlWindowSize): ControlWindowSize {
  // window.resizeTo targets the outer window for normal popups. Document PiP implementations
  // often expose no meaningful chrome delta, so this resolves to the content size there.
  if (host === window) return contentSize;
  const outerWidth = finitePositive(host.outerWidth);
  const innerWidth = finitePositive(host.innerWidth);
  const outerHeight = finitePositive(host.outerHeight);
  const innerHeight = finitePositive(host.innerHeight);
  return {
    width: contentSize.width + (outerWidth !== null && innerWidth !== null ? Math.max(0, Math.round(outerWidth - innerWidth)) : 0),
    height: contentSize.height + (outerHeight !== null && innerHeight !== null ? Math.max(0, Math.round(outerHeight - innerHeight)) : 0),
  };
}

function applyShrinkWrappedDocumentStyles(
  doc: Document,
  size: ControlWindowSize,
  options?: { transition?: string; mode?: ControlWindowMode },
): void {
  const docked = options?.mode === 'docked';
  const root = doc.documentElement.style;
  root.background = 'transparent';
  root.colorScheme = 'dark';
  root.overflow = 'hidden';
  root.boxSizing = 'border-box';
  root.minWidth = '0';
  root.minHeight = '0';
  root.width = `${size.width}px`;
  root.height = `${size.height}px`;
  doc.body.classList.remove('desktop-countdown-pip');

  const body = doc.body.style;
  body.margin = '0';
  body.padding = '0';
  body.background = 'transparent';
  body.overflow = 'hidden';
  body.boxSizing = 'border-box';
  body.minWidth = '0';
  body.minHeight = '0';
  // Use viewport-sized body so if the browser keeps a larger PiP minimum size,
  // the tiny REC dock can still sit on the lower-right edge instead of floating
  // in the upper-left corner. When resizeTo succeeds, 100vw/100vh equals `size`.
  body.width = '100vw';
  body.height = '100vh';
  body.display = 'flex';
  body.alignItems = docked ? 'flex-end' : 'flex-start';
  body.justifyContent = docked ? 'flex-end' : 'center';
  body.fontFamily = 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  body.transition = options?.transition ?? 'none';
}

function applyFullscreenCountdownDocumentStyles(doc: Document, size: ControlWindowSize): void {
  const root = doc.documentElement.style;
  root.background = 'rgba(241, 241, 237, 0.72)';
  root.colorScheme = 'light';
  root.overflow = 'hidden';
  root.boxSizing = 'border-box';
  root.minWidth = '0';
  root.minHeight = '0';
  root.width = `${size.width}px`;
  root.height = `${size.height}px`;

  const body = doc.body.style;
  body.margin = '0';
  body.padding = '0';
  body.background = 'rgba(241, 241, 237, 0.72)';
  body.overflow = 'hidden';
  body.boxSizing = 'border-box';
  body.minWidth = '0';
  body.minHeight = '0';
  body.width = `${size.width}px`;
  body.height = `${size.height}px`;
  body.display = 'grid';
  body.alignItems = 'stretch';
  body.justifyContent = 'stretch';
  body.fontFamily = 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  body.transition = 'background 180ms ease';
  doc.body.classList.add('desktop-countdown-pip');
}

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
    doc.documentElement.dataset.recordingControlsWindow = 'full';
    doc.documentElement.dataset.recordingControlsTargetSize = `${CONTROLS_WINDOW_SIZE.width}x${CONTROLS_WINDOW_SIZE.height}`;
    applyShrinkWrappedDocumentStyles(doc, CONTROLS_WINDOW_SIZE, { mode: 'full' });
    doc.body.dataset.recordingControlsWindow = 'full';
    // 贴顶而不是居中：当浏览器对 Document PiP 保留少量原生最小高度时，
    // 居中会把剩余空间显到控制条底边；贴顶能让可压缩空间被推到宿主尾部。
    doc.body.classList.add('desktop-recording-controls-pip');
  }
  return host;
}

/**
 * Full-screen-ish countdown host for desktop/window capture. It is requested
 * directly from the user's “start countdown” click because Document PiP cannot
 * be opened later from an automatic timer without transient activation.
 */
export async function requestFullscreenCountdownWindow(): Promise<Window | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
  const size = getFullscreenCountdownWindowSize();
  const host = api?.requestWindow
    ? await api.requestWindow({
        ...size,
        disallowReturnToOpener: true,
        preferInitialWindowPlacement: true,
      })
    : window.open(
        '',
        'excalicast-countdown',
        `popup=yes,width=${size.width},height=${size.height},left=0,top=0,resizable=yes`,
      ) ?? null;
  if (!host) return null;
  const doc = host.document;
  if (host !== window) {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      doc.head.appendChild(node.cloneNode(true));
    });
    doc.title = '';
    doc.documentElement.dataset.recordingControlsWindow = 'countdown-fullscreen';
    doc.documentElement.dataset.recordingControlsTargetSize = `${size.width}x${size.height}`;
    doc.body.dataset.recordingControlsWindow = 'countdown-fullscreen';
    applyFullscreenCountdownDocumentStyles(doc, size);
    try { host.resizeTo(size.width, size.height); } catch { /* best-effort */ }
  }
  return host;
}

interface Props {
  host: Window | null;
  bar: RecordingBarProps | null;
  /** True for desktop/window capture: the host should open already docked after countdown. */
  initialDocked?: boolean;
  /** True for desktop/window capture: resize the outer host to the measured control content. */
  adaptiveWindow?: boolean;
}

export function DesktopRecordingControls({ host, bar, initialDocked = false, adaptiveWindow = false }: Props): JSX.Element | null {
  const isActive = !!host && !!bar && (bar.state === 'recording' || bar.state === 'paused');

  const [docked, setDocked] = useState(initialDocked);
  const [measuredWindow, setMeasuredWindow] = useState<MeasuredControlWindow | null>(null);
  const [resizeStatus, setResizeStatus] = useState<'ok' | 'failed'>('ok');
  const contentRef = useRef<HTMLDivElement>(null);
  const dockSizerRef = useRef<HTMLDivElement>(null);
  const fullSizerRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

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

  const clearResizeTimer = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
  }, []);

  const measureMode = useCallback((mode: ControlWindowMode): ControlWindowSize => {
    const node = mode === 'docked' ? dockSizerRef.current : fullSizerRef.current;
    const rect = node?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    }
    return mode === 'docked'
      ? (adaptiveWindow ? ADAPTIVE_DOCKED_CONTROLS_WINDOW_SIZE : LEGACY_DOCKED_CONTROLS_WINDOW_SIZE)
      : CONTROLS_WINDOW_SIZE;
  }, [adaptiveWindow]);

  const applyHostSize = useCallback((
    mode: ControlWindowMode,
    contentSize: ControlWindowSize,
    resizeOuterWindow: boolean,
  ) => {
    if (!host || host.closed) return;
    const doc = host.document;
    const ownsSeparateDocument = doc !== document;
    doc.documentElement.dataset.recordingControlsWindow = mode;
    doc.documentElement.dataset.recordingControlsTargetSize = `${contentSize.width}x${contentSize.height}`;
    doc.body.dataset.recordingControlsWindow = mode;
    const resizeTarget = getOuterWindowTargetSize(host, contentSize);
    doc.documentElement.dataset.recordingControlsOuterTargetSize = `${resizeTarget.width}x${resizeTarget.height}`;
    if (ownsSeparateDocument || host !== window) {
      applyShrinkWrappedDocumentStyles(doc, contentSize, { mode });
    }
    if (resizeOuterWindow && host !== window) {
      try {
        host.resizeTo(resizeTarget.width, resizeTarget.height);
        if (mode === 'docked') {
          const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
          const screenLeft = finitePositive(screen.availLeft ?? Number.NaN) ?? 0;
          const screenTop = finitePositive(screen.availTop ?? Number.NaN) ?? 0;
          const screenWidth = finitePositive(screen.availWidth) ?? window.innerWidth;
          const screenHeight = finitePositive(screen.availHeight) ?? window.innerHeight;
          try {
            host.moveTo(
              Math.max(screenLeft, screenLeft + screenWidth - resizeTarget.width - 18),
              Math.max(screenTop, screenTop + screenHeight - resizeTarget.height - 18),
            );
          } catch {
            // Document PiP usually ignores programmatic positioning; popup fallback may honor it.
          }
        }
        setResizeStatus('ok');
      } catch {
        // Document PiP resize is intentionally best-effort: browsers may reject
        // resizeTo() even after a user click. Keep controls usable and record the
        // failed state for tests, but do not render an explanatory note inside
        // the tiny control host.
        setResizeStatus('failed');
      }
    }
  }, [host]);

  const expandControls = useCallback(() => {
    const size = measureMode('full');
    setMeasuredWindow({ mode: 'full', size });
    applyHostSize('full', size, true);
    clearLeaveTimer();
    clearResizeTimer();
    setDocked(false);
  }, [adaptiveWindow, applyHostSize, clearLeaveTimer, clearResizeTimer, measureMode]);

  const collapseControls = useCallback(() => {
    const size = measureMode('docked');
    setMeasuredWindow({ mode: 'docked', size });
    applyHostSize('docked', size, true);
    clearLeaveTimer();
    clearResizeTimer();
    setDocked(true);
  }, [adaptiveWindow, applyHostSize, clearLeaveTimer, clearResizeTimer, measureMode]);

  // 开录后不需要整段工具条长期遮在桌面/窗口上：先留一小段时间让用户确认状态，
  // 再收成可见的 REC 边签。鼠标回到边签即可恢复所有控制。
  useEffect(() => {
    if (!isActive) {
      setDocked(initialDocked);
      setResizeStatus('ok');
      return;
    }
    if (initialDocked) {
      setDocked(true);
      return () => {
        clearLeaveTimer();
        clearResizeTimer();
      };
    }
    setDocked(false);
    const id = window.setTimeout(() => setDocked(true), AUTO_DOCK_DELAY_MS);
    return () => {
      window.clearTimeout(id);
      clearLeaveTimer();
      clearResizeTimer();
    };
  }, [clearLeaveTimer, clearResizeTimer, initialDocked, isActive]);

  useLayoutEffect(() => {
    if (!isActive || !contentRef.current) return;
    const node = contentRef.current;
    const mode: ControlWindowMode = docked ? 'docked' : 'full';
    const measure = () => {
      const measured = adaptiveWindow ? measureMode(mode) : null;
      const rect = node.getBoundingClientRect();
      const width = measured?.width ?? Math.max(1, Math.ceil(rect.width));
      const height = measured?.height ?? Math.max(1, Math.ceil(rect.height));
      setMeasuredWindow((current) => (
        current?.mode === mode && current.size.width === width && current.size.height === height
          ? current
          : { mode, size: { width, height } }
      ));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [adaptiveWindow, docked, isActive, measureMode]);

  // 普通 popup 可以真实缩小窗口；Document PiP 的 resizeTo 支持由浏览器决定，
  // 但外层窗口必须跟随内容尺寸尽力同步：自动收起为 REC 边签时，也不能留下
  // 一块固定 560px 的透明宿主空白。
  useLayoutEffect(() => {
    if (!isActive || !host || host.closed) return;
    const mode: ControlWindowMode = docked ? 'docked' : 'full';
    const fallback = docked
      ? (adaptiveWindow ? ADAPTIVE_DOCKED_CONTROLS_WINDOW_SIZE : LEGACY_DOCKED_CONTROLS_WINDOW_SIZE)
      : CONTROLS_WINDOW_SIZE;
    const measuredSize = measuredWindow?.mode === mode ? measuredWindow.size : null;
    const next = adaptiveWindow && measuredSize ? measuredSize : fallback;
    applyHostSize(mode, next, adaptiveWindow);
    if (adaptiveWindow) return;

    clearResizeTimer();
    let step = 0;
    const outerTarget = getOuterWindowTargetSize(host, next);
    const startWidth = finitePositive(host.outerWidth) ?? outerTarget.width;
    const startHeight = finitePositive(host.outerHeight) ?? outerTarget.height;
    const tick = () => {
      step += 1;
      const p = 1 - Math.pow(1 - step / HOST_RESIZE_STEPS, 3);
      const width = Math.round(startWidth + (outerTarget.width - startWidth) * p);
      const height = Math.round(startHeight + (outerTarget.height - startHeight) * p);
      if (host !== window) {
        try {
          host.resizeTo(width, height);
          setResizeStatus('ok');
        } catch {
          setResizeStatus('failed');
        }
      }
      if (step < HOST_RESIZE_STEPS) resizeTimerRef.current = window.setTimeout(tick, HOST_RESIZE_STEP_MS);
      else resizeTimerRef.current = null;
    };
    tick();
    return clearResizeTimer;
  }, [adaptiveWindow, applyHostSize, clearResizeTimer, host, docked, isActive, measuredWindow]);

  if (!isActive || !host || !bar) return null;

  return createPortal(
    <>
    <div
      data-testid="desktop-recording-controls"
      data-docked={docked ? 'true' : 'false'}
      data-resize-status={resizeStatus}
      ref={contentRef}
      className="rb-no-record"
      style={{
        display: 'inline-flex',
        width: 'max-content',
        height: 'max-content',
        minWidth: 0,
        padding: 0,
        boxSizing: 'border-box',
        alignItems: 'center',
        justifyContent: 'center',
        justifySelf: docked ? 'end' : 'center',
        transition: 'opacity 160ms ease, transform 180ms cubic-bezier(.2,.8,.2,1)',
      }}
      onPointerEnter={adaptiveWindow ? undefined : reveal}
      onPointerLeave={adaptiveWindow ? undefined : scheduleDock}
    >
      {docked ? (
        <DockButton bar={bar} onExpand={adaptiveWindow ? expandControls : reveal} />
      ) : <FullRecordingControls bar={bar} onCollapse={adaptiveWindow ? collapseControls : undefined} />}
    </div>
    <div
      aria-hidden="true"
      className="rb-no-record"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        visibility: 'hidden',
        pointerEvents: 'none',
        width: 'max-content',
        height: 'max-content',
        overflow: 'hidden',
        contain: 'layout style',
      }}
    >
      <div ref={dockSizerRef} style={{ width: 'max-content', height: 'max-content' }}>
        <DockButton bar={bar} onExpand={() => undefined} measurement />
      </div>
      <div ref={fullSizerRef} style={{ width: 'max-content', height: 'max-content' }}>
        <FullRecordingControls bar={bar} onCollapse={adaptiveWindow ? () => undefined : undefined} measurement />
      </div>
    </div>
    </>,
    host.document.body,
  );
}

function DockButton({ bar, onExpand, measurement = false }: { bar: RecordingBarProps; onExpand: () => void; measurement?: boolean }): JSX.Element {
  const isRec = bar.state === 'recording';
  const toggleLabel = isRec ? 'Pause recording' : 'Resume recording';
  const ToggleIcon = isRec ? 'Ⅱ' : '▶';
  return (
    <div
      data-testid={measurement ? undefined : 'desktop-recording-controls-dock'}
      role="group"
      aria-label="Docked recording controls"
      style={{
        display: 'flex',
        boxSizing: 'border-box',
        alignItems: 'center',
        width: 'max-content',
        minHeight: 0,
        gap: 4,
        padding: '4px 6px',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: 999,
        background: 'rgba(18,19,20,.94)',
        color: '#fffdf8',
        boxShadow: '0 12px 28px rgba(20,22,24,.14), inset 0 1px 0 rgba(255,255,255,.10)',
        backdropFilter: 'blur(16px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
      }}
    >
      <button
        type="button"
        onClick={measurement ? undefined : onExpand}
        tabIndex={measurement ? -1 : undefined}
        aria-label="Show recording controls"
        aria-expanded="false"
        title="Show recording controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          height: 38,
          padding: '0 8px 0 7px',
          border: 'none',
          borderRadius: 999,
          background: 'transparent',
          color: '#fffdf8',
          boxShadow: 'none',
          fontFamily: 'var(--font-sans)',
          cursor: measurement ? 'default' : 'pointer',
        }}
      >
        <span className={bar.state === 'recording' ? 'recording-indicator' : ''} style={{ width: 8, height: 8, borderRadius: 999, background: bar.state === 'recording' ? 'var(--rec)' : 'rgba(255,255,255,.52)' }} />
        <span style={{ fontSize: 11, fontWeight: 780, letterSpacing: '.035em' }}>{bar.state === 'recording' ? 'REC' : 'PAUSED'}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 650, opacity: .9 }}>{formatElapsed(bar.elapsedMs)}</span>
      </button>
      <span aria-hidden="true" style={{ width: 1, height: 26, background: 'rgba(255,255,255,.13)' }} />
      <DockControlButton
        label={toggleLabel}
        text={ToggleIcon}
        onClick={isRec ? bar.onPause : bar.onResume}
        measurement={measurement}
      />
      <DockControlButton
        label="Stop recording"
        text="■"
        tone="rec"
        onClick={bar.onStop}
        measurement={measurement}
      />
    </div>
  );
}

function DockControlButton({
  label,
  text,
  tone,
  onClick,
  measurement,
}: {
  label: string;
  text: string;
  tone?: 'rec';
  onClick?: () => void | Promise<void>;
  measurement?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={measurement ? undefined : label}
      aria-hidden={measurement ? true : undefined}
      title={measurement ? undefined : label}
      onClick={measurement ? undefined : () => { void onClick?.(); }}
      tabIndex={measurement ? -1 : undefined}
      disabled={!measurement && !onClick}
      style={{
        display: 'grid',
        placeItems: 'center',
        minWidth: 36,
        height: 38,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: tone === 'rec' ? 'rgba(255,76,68,.92)' : 'rgba(255,255,255,.08)',
        color: '#fffdf8',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10)',
        fontFamily: 'var(--font-sans)',
        fontSize: tone === 'rec' ? 15 : 17,
        fontWeight: 850,
        lineHeight: 1,
        cursor: measurement ? 'default' : 'pointer',
      }}
    >
      {text}
    </button>
  );
}

function FullRecordingControls({ bar, onCollapse, measurement = false }: { bar: RecordingBarProps; onCollapse?: () => void; measurement?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', gap: 4 }}>
      <RecordingBar {...bar} />
      {onCollapse && (
        <button
          type="button"
          aria-label={measurement ? undefined : 'Collapse recording controls'}
          aria-hidden={measurement ? true : undefined}
          title={measurement ? undefined : 'Collapse recording controls'}
          onClick={measurement ? undefined : onCollapse}
          tabIndex={measurement ? -1 : undefined}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 34,
            height: 34,
            padding: 0,
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 999,
            background: 'rgba(18,19,20,.94)',
            color: '#fffdf8',
            boxShadow: '0 12px 26px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.10)',
            fontFamily: 'var(--font-sans)',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ‹
        </button>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
