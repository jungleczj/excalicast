'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations, useLocale } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { RecordingBar, type RecordingBarProps } from '@/components/RecordingBar';
import { RecordingSetup } from '@/components/RecordingSetup';
import { CameraBubble } from '@/components/CameraBubble';
import { Teleprompter } from '@/components/Teleprompter';
import { AspectCropOverlay } from '@/components/AspectCropOverlay';
import { DisplaySourceCropOverlay } from '@/components/DisplaySourceCropOverlay';
import { DisplaySourcePreview } from '@/components/DisplaySourcePreview';
import { DesktopRecordingControls, requestDesktopRecordingControlsWindow } from '@/components/DesktopRecordingControls';
import { I } from '@/components/icons';
import { useSubscription } from '@/hooks/useSubscription';
import { startRecording, type SessionHandle, type CameraFrameRect } from '@/services/recordingSession';
import { acquireMicStream } from '@/services/audioRecorder';
import { acquireCameraStream } from '@/services/cameraRecorder';
import { acquireDisplayStream, getDisplayStreamPixelSize } from '@/services/displayCaptureRecorder';
import { trackEvent } from '@/lib/analytics/track';
import type { WhiteboardChangeFn } from '@/components/Whiteboard';
import type { CameraCorner, CameraShape, CropWindow, RecordingSetupConfig, SourceCropWindow } from '@/types/recording';
import { useRouter } from '@/i18n/navigation';

const DEFAULT_SETUP: RecordingSetupConfig = {
  framing: '16:9',
  croppingMode: 'follow_viewport',
  includeWorkspaceShell: false,
  camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false },
  videoBackground: { kind: 'none' },
  source: { kind: 'whiteboard' },
};

function evenPixel(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function formatRecordingElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function sourceSizeForCrop(
  size: { width: number; height: number; frameRate?: number } | undefined,
  crop: SourceCropWindow,
): { width: number; height: number; frameRate?: number } | undefined {
  if (!size?.width || !size.height) return undefined;
  return {
    width: evenPixel(size.width * crop.rw),
    height: evenPixel(size.height * crop.rh),
    frameRate: size.frameRate,
  };
}

/** 摄像头气泡角落预设 → 视口像素坐标（与 CameraBubble 的 fixed 定位一致）。 */
function cornerToXY(corner: CameraCorner, sizePx: number): { x: number; y: number } {
  const margin = 24;
  const headerOffset = 64; // AppHeader 高度
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? margin : Math.max(margin, w - sizePx - margin),
    y: top ? headerOffset + margin : Math.max(headerOffset + margin, h - sizePx - margin),
  };
}

const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
  // 跳转后白板 chunk（连带 Excalidraw）还在加载时的占位骨架 —— 让「已进录制页、正在载入画板」体感明确。
  loading: () => (
    <div className="dots-fine grid h-full place-items-center" style={{ background: 'var(--paper-2)' }}>
      <div className="fade-in flex flex-col items-center gap-3" style={{ color: 'var(--ink-3)' }}>
        <span className="camera-idle-pulse" style={{ fontFamily: 'var(--font-hand)', fontSize: 22 }}>Excalicast</span>
        <span className="label-mono" style={{ fontSize: 10 }}>loading board…</span>
      </div>
    </div>
  ),
});

// 非关键组件懒加载：仅在打开时才载入对应 chunk，缩小 /app 首屏编译/首包。
// 三者关闭时都 return null（无退出动画），渲染处用 `&&` 门控以真正延迟 chunk。
const LibraryDrawer = dynamic(() => import('@/components/LibraryDrawer').then((m) => m.LibraryDrawer), { ssr: false });
const ProUpgradeModal = dynamic(() => import('@/components/ProUpgradeModal').then((m) => m.ProUpgradeModal), { ssr: false });
const FirstRunGuide = dynamic(() => import('@/components/onboarding/FirstRunGuide').then((m) => m.FirstRunGuide), { ssr: false });

export default function HomePage(): JSX.Element {
  const t = useTranslations('workspace');
  const router = useRouter();
  const subscription = useSubscription();
  const [state, setState] = useState<'idle' | 'framing' | 'recording' | 'paused' | 'processing'>('idle');
  const [elapsed, setElapsed] = useState<number>(0);
  const [hasAudio, setHasAudio] = useState<boolean>(false);
  const [hasCamera, setHasCamera] = useState<boolean>(false);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0 });
  const [cameraSize, setCameraSize] = useState(160);
  const [cameraShape, setCameraShape] = useState<CameraShape>('circle');
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);
  // 录制前 Setup 面板 + 倒计时
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupConfig, setSetupConfig] = useState<RecordingSetupConfig>(DEFAULT_SETUP);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [framingWarn, setFramingWarn] = useState(false);
  const pendingStartRef = useRef<{ config: RecordingSetupConfig; pos: { x: number; y: number }; size: number } | null>(null);
  // 取景阶段预采集的麦克风流（开录时复用，避免倒计时后才申请权限）
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  micStreamRef.current = micStream;
  // 取景阶段预采集的显示源流（开录时复用，避免倒计时后才申请权限）
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  displayStreamRef.current = displayStream;
  const [displayAspect, setDisplayAspect] = useState<number | null>(null);
  const [sourceCropWindow, setSourceCropWindow] = useState<SourceCropWindow | null>(null);
  // 裁切框（画布区比例）+ Custom 输出尺寸；录制中由 overlay 编辑
  const [cropWindow, setCropWindow] = useState<CropWindow | null>(null);
  const [customOutput, setCustomOutput] = useState<{ width: number; height: number } | undefined>(undefined);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const cropWindowRef = useRef<CropWindow | null>(null);
  cropWindowRef.current = cropWindow;

  // 录制条位置：默认放在 Excalidraw toolbar 之下、右上角，避开顶部菜单
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const [desktopControlHost, setDesktopControlHost] = useState<Window | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; barX: number; barY: number } | null>(null);
  const [draggingBar, setDraggingBar] = useState(false);
  const [recordingBarDocked, setRecordingBarDocked] = useState(false);

  const sessionRef = useRef<SessionHandle | null>(null);
  const stoppingRef = useRef(false);
  const changeRef = useRef<WhiteboardChangeFn | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const cameraPosLsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraSizeLsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excalidrawApiRef = useRef<any>(null);
  const laserPointRef = useRef<((x: number, y: number, button: 'down' | 'up') => void) | null>(null);
  const en = useLocale() === 'en';
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  // 演示缩放：双击画布放大/还原（开关 or Alt/⌘+双击）
  const [zoomMode, setZoomMode] = useState(false);
  const zoomedRef = useRef(false);
  const prevViewportRef = useRef<{ zoom: number; scrollX: number; scrollY: number } | null>(null);
  const zoomAnimRef = useRef<number | null>(null);
  const [laserActive, setLaserActive] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [isCanvasEmpty, setIsCanvasEmpty] = useState(true);

  // 首次访问引导：仅当未看过时显示（localStorage 记忆）
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('login') === '1') return;
      if (!localStorage.getItem('excalicast.seenAppIntro')) setShowIntro(true);
    } catch { /* private mode */ }
  }, []);
  const dismissIntro = useCallback(() => {
    setShowIntro(false);
    try { localStorage.setItem('excalicast.seenAppIntro', '1'); } catch { /* ignore */ }
  }, []);

  // 空画布检测：idle 时轻量轮询 Excalidraw 场景元素数，驱动「空状态」提示。
  useEffect(() => {
    if (state !== 'idle') return;
    const check = () => {
      try {
        const els = excalidrawApiRef.current?.getSceneElements?.();
        setIsCanvasEmpty(!els || els.length === 0);
      } catch { /* api 未就绪 */ }
    };
    check();
    const id = setInterval(check, 1500);
    return () => clearInterval(id);
  }, [state]);

  // Creem 在新标签页支付后会重定向回 /app?creem_purchase=…。消费该参数：刷新会员态、
  // 给个「支付完成」提示并清掉 query（避免刷新重复触发 / 死页）。原标签的恢复由弹窗的
  // visibility 重查负责（导出自动、订阅回到已解锁面板）。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('creem_purchase')) return;
    setPaymentDone(true);
    void subscription.refresh?.();
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    const tid = setTimeout(() => setPaymentDone(false), 6000);
    return () => clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化摄像头位置（优先 localStorage，否则右下角默认）
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // 先恢复气泡尺寸（用于把位置约束在视口内）
    let initSize = 160;
    const savedSize = localStorage.getItem('excalicast.camera-size');
    if (savedSize) {
      const s = Number(savedSize);
      if (Number.isFinite(s)) {
        initSize = Math.max(80, Math.min(480, Math.round(s)));
        setCameraSize(initSize);
      }
    }

    const savedCam = localStorage.getItem('excalicast.camera-pos');
    if (savedCam) {
      try {
        const p = JSON.parse(savedCam);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          // 约束到当前视口内，防止上次窗口比这次大时跑到屏幕外
          setCameraPos({
            x: Math.max(0, Math.min(w - initSize, p.x)),
            y: Math.max(0, Math.min(h - initSize, p.y)),
          });
        } else {
          setCameraPos({ x: w - 200, y: h - 280 });
        }
      } catch {
        setCameraPos({ x: w - 200, y: h - 280 });
      }
    } else {
      setCameraPos({ x: w - 200, y: h - 280 });
    }

    // 录制条默认位置：从 localStorage 读，否则放右下角靠左（避开 Excalidraw 的 toolbar）
    const saved = localStorage.getItem('excalicast.recording-bar-pos');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          setBarPos(p);
          return;
        }
      } catch { /* ignore */ }
    }
    // 默认底部居中（Excalidraw 的 toolbar 在顶部，避开它）
    setBarPos({ x: w / 2 - 200, y: h - 96 });
  }, []);

  // 摄像头位置变更：(1) 录制中转发给 session；(2) debounced 写 localStorage
  // 当前裁切框的 viewport 矩形（固定比例时；default 返回 null=相对 shell）
  const getCropFrameRect = useCallback((): CameraFrameRect | null => {
    const cw = cropWindowRef.current;
    const area = canvasAreaRef.current;
    if (!cw || !area || setupConfig.framing === 'default') return null;
    const r = area.getBoundingClientRect();
    return { x: r.left + cw.rx * r.width, y: r.top + cw.ry * r.height, w: cw.rw * r.width, h: cw.rh * r.height };
  }, [setupConfig.framing]);

  const handleCameraPositionChange = useCallback((p: { x: number; y: number }) => {
    // 选定裁切框后（非 default）：把气泡钳制在裁切框屏幕矩形内
    const frame = getCropFrameRect();
    if (frame) {
      p = {
        x: Math.max(frame.x, Math.min(frame.x + frame.w - cameraSize, p.x)),
        y: Math.max(frame.y, Math.min(frame.y + frame.h - cameraSize, p.y)),
      };
      setFramingWarn(false); // 钳制后必在框内，清除告警
    }
    setCameraPos(p);
    // 录制中：viewport 坐标 + size + 裁切框矩形 喂给 session（相对裁切框存）
    if (sessionRef.current) {
      sessionRef.current.recordCameraMove(p.x, p.y, cameraSize, frame);
    }
    // UX：跨刷新记住位置（debounce 250ms 避免拖拽时写爆 localStorage）
    if (cameraPosLsTimerRef.current !== null) clearTimeout(cameraPosLsTimerRef.current);
    cameraPosLsTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('excalicast.camera-pos', JSON.stringify(p)); }
      catch { /* quota / private mode */ }
    }, 250);
  }, [cameraSize, getCropFrameRect]);

  // 摄像头尺寸变更：(1) 录制中转发给 session（位置不变、size 变）；(2) debounced 写 localStorage
  const handleCameraSizeChange = useCallback((next: number) => {
    setCameraSize(next);
    if (sessionRef.current) {
      sessionRef.current.recordCameraMove(cameraPos.x, cameraPos.y, next, getCropFrameRect());
    }
    if (cameraSizeLsTimerRef.current !== null) clearTimeout(cameraSizeLsTimerRef.current);
    cameraSizeLsTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('excalicast.camera-size', String(next)); }
      catch { /* quota / private mode */ }
    }, 250);
  }, [cameraPos.x, cameraPos.y, getCropFrameRect]);

  // 演示缩放：双击画布某点放大 ~2× 并居中、再双击还原；缓入缓出避免镜头突跳。
  const zoomToPoint = useCallback((clientX: number, clientY: number) => {
    const api = excalidrawApiRef.current;
    if (!api?.getAppState || !api?.updateScene) return;
    type VP = { zoom: number; scrollX: number; scrollY: number };
    const animate = (from: VP, to: VP, ms = 520) => {
      if (zoomAnimRef.current) cancelAnimationFrame(zoomAnimRef.current);
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        const e = k < 0.5
          ? 4 * k * k * k
          : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
        api.updateScene({ appState: {
          zoom: { value: from.zoom + (to.zoom - from.zoom) * e },
          scrollX: from.scrollX + (to.scrollX - from.scrollX) * e,
          scrollY: from.scrollY + (to.scrollY - from.scrollY) * e,
        } });
        if (k < 1) zoomAnimRef.current = requestAnimationFrame(tick);
      };
      zoomAnimRef.current = requestAnimationFrame(tick);
    };
    const app = api.getAppState();
    const cur: VP = { zoom: app.zoom.value, scrollX: app.scrollX, scrollY: app.scrollY };
    if (zoomedRef.current && prevViewportRef.current) {
      animate(cur, prevViewportRef.current);
      zoomedRef.current = false;
      prevViewportRef.current = null;
      return;
    }
    prevViewportRef.current = cur;
    const z = app.zoom.value;
    const sceneX = (clientX - (app.offsetLeft ?? 0)) / z - app.scrollX;
    const sceneY = (clientY - (app.offsetTop ?? 0)) / z - app.scrollY;
    const newZoom = Math.min(8, z * 2);
    const w = app.width ?? window.innerWidth;
    const h = app.height ?? window.innerHeight;
    animate(cur, { zoom: newZoom, scrollX: w / 2 / newZoom - sceneX, scrollY: h / 2 / newZoom - sceneY });
    zoomedRef.current = true;
  }, []);

  // 捕获阶段双击：缩放模式开 或 Alt/⌘ → 拦截 Excalidraw「双击建文字」并缩放。
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent) => {
      if (zoomMode || e.altKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        zoomToPoint(e.clientX, e.clientY);
      }
    };
    el.addEventListener('dblclick', onDbl, true);
    return () => el.removeEventListener('dblclick', onDbl, true);
  }, [zoomMode, zoomToPoint]);

  // 缩放模式开启时切到 hand 工具（双击空白不再建文字），关闭还原选择工具。
  useEffect(() => {
    const api = excalidrawApiRef.current;
    if (!api?.setActiveTool) return;
    try { api.setActiveTool({ type: zoomMode ? 'hand' : 'selection' }); } catch { /* */ }
  }, [zoomMode]);

  // 拖拽逻辑
  useEffect(() => {
    if (!draggingBar) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const nx = start.barX + (e.clientX - start.mouseX);
      const ny = start.barY + (e.clientY - start.mouseY);
      // 简单边界约束：不让拖出窗口
      const w = window.innerWidth;
      const h = window.innerHeight;
      setBarPos({
        x: Math.max(0, Math.min(w - 80, nx)),
        y: Math.max(8, Math.min(h - 60, ny)),
      });
    };
    const onUp = () => {
      setDraggingBar(false);
      if (barPos) localStorage.setItem('excalicast.recording-bar-pos', JSON.stringify(barPos));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingBar, barPos]);

  const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
    // 只在按下「非按钮」区域时才开始拖（让按钮 click 正常工作）
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (!barPos) return;
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      barX: barPos.x,
      barY: barPos.y,
    };
    setDraggingBar(true);
  }, [barPos]);

  useEffect(() => {
    if (state === 'recording') {
      // 秒级时钟即可，1s 一跳避免录制中 4Hz 全量重渲染造成的卡顿
      tickRef.current = setInterval(() => {
        if (sessionRef.current) setElapsed(sessionRef.current.getElapsedMs());
      }, 1000);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }
    if (state === 'idle') {
      setElapsed(0);
    }
  }, [state]);
  // ⚠️ 录制时长不做任何 cap（产品级约束，见 CLAUDE.md）。不要在此添加 elapsed 检查。

  const handleToggleCamera = useCallback(async () => {
    if (state !== 'idle') return;
    if (cameraEnabled) {
      // 关闭：停掉测试流（如果有）
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setCameraEnabled(false);
      return;
    }
    // 开启：先请求权限并展示预览，确认能用再切开关
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      setCameraStream(stream);
      setCameraEnabled(true);
    } catch (err) {
      alert(t('cameraOpenFailed', { message: err instanceof Error ? err.message : 'unknown' }));
    }
  }, [cameraEnabled, cameraStream, state, t]);

  // idle 态点「开始」：打开录制前 Setup 面板（替代直接开录）
  const handleStart = useCallback(() => {
    setSetupConfig((prev) => ({
      ...prev,
      camera: { ...prev.camera, enabled: cameraEnabled, sizePx: cameraSize, shape: cameraShape },
    }));
    setSetupOpen(true);
  }, [cameraEnabled, cameraSize, cameraShape]);

  const clearDisplayStream = useCallback(() => {
    displayStreamRef.current?.getTracks().forEach((tk) => tk.stop());
    displayStreamRef.current = null;
    setDisplayStream(null);
    setDisplayAspect(null);
    setSourceCropWindow(null);
  }, []);

  const closeDesktopControls = useCallback(() => {
    setDesktopControlHost((host) => {
      if (host && host !== window && !host.closed) host.close();
      return null;
    });
  }, []);

  const openDesktopControls = useCallback(async () => {
    if (desktopControlHost) return;
    try {
      const host = await requestDesktopRecordingControlsWindow();
      if (!host) return;
      if (host !== window) {
        host.addEventListener('pagehide', () => setDesktopControlHost(null), { once: true });
      }
      setDesktopControlHost(host);
    } catch {
      // 浏览器不支持/用户关闭 Picture-in-Picture 时，继续使用页面内控制条。
    }
  }, [desktopControlHost]);

  useEffect(() => () => closeDesktopControls(), [closeDesktopControls]);

  // 真正开录（取景确认 + 倒计时结束后调用）—— 复用取景已采集的麦克风/摄像头流，瞬时开录
  const beginRecording = useCallback(async (config: RecordingSetupConfig, startPos: { x: number; y: number }, startSize: number) => {
    try {
      const session = await startRecording({
        withCamera: config.camera.enabled,
        workspaceRoot: workspaceRootRef.current,
        setup: config,
        audioStream: micStreamRef.current,
        cameraStream,
        displayStream: displayStreamRef.current,
      });
      // 流所有权移交 session（stop 时由其停轨）；保留 React state 供录制期间的实况预览与选区边框使用。
      // ref 清空避免页面侧重复 stop，state 只负责显示，停止/丢弃时统一由 clearDisplayStream 清掉。
      setMicStream(null);
      displayStreamRef.current = null;
      sessionRef.current = session;
      changeRef.current = session.onWhiteboardChange;
      laserPointRef.current = session.recordLaserPoint;
      // Excalidraw 不会因为「开始录制」自动触发 onChange。若画板在开录前已有内容，
      // 必须立即写入 t=0 快照，否则回放/导出只能拿到背景而没有实际白板画面。
      if (config.source?.kind === 'whiteboard') {
        const api = excalidrawApiRef.current;
        const elements = api?.getSceneElements?.();
        const appState = api?.getAppState?.();
        if (elements && appState) {
          session.onWhiteboardChange(elements, appState, api?.getFiles?.() ?? {});
        }
      }
      setHasAudio(session.hasAudio);
      setHasCamera(session.hasCamera);
      setCameraStream(session.cameraStream);
      setState('recording');
      trackEvent('recording_start', {
        framing: config.framing,
        withCamera: config.camera.enabled,
        withAudio: session.hasAudio,
        source: config.source?.kind ?? 'whiteboard',
      });
      // 录制开始种一颗 t=0 事件，定位当前气泡位置
      if (session.hasCamera) {
        session.recordCameraMove(startPos.x, startPos.y, startSize);
      }
    } catch (err) {
      alert(t('startFailed', { message: err instanceof Error ? err.message : 'unknown' }));
    }
  }, [cameraStream, t]);

  // Setup 面板确认：应用配置 → 进入取景态（在画布上框选裁切框/摆相机），暂不倒计时
  const handleSetupConfirm = useCallback(async (config: RecordingSetupConfig) => {
    let nextConfig = config;
    setSetupConfig(nextConfig);
    setSetupOpen(false);
    // 裁切框重置 → overlay 按所选比例居中初始化（default 不显框）
    setCropWindow(null);
    setCustomOutput(undefined);
    clearDisplayStream();
    setCameraEnabled(config.camera.enabled);
    setCameraSize(config.camera.sizePx);
    setCameraShape(config.camera.shape);
    setCameraPos(cornerToXY(config.camera.position, config.camera.sizePx));
    // 取景预览：启用相机则申请预览流（与录制同约束，开录直接复用）；否则停掉已有预览
    if (config.camera.enabled) {
      if (!cameraStream) {
        try { setCameraStream(await acquireCameraStream()); }
        catch { /* 取景无预览不阻塞，开录时再申请 */ }
      }
    } else {
      cameraStream?.getTracks().forEach((tk) => tk.stop());
      setCameraStream(null);
    }
    // 显示源预采集：浏览器仍会展示自己的选择器；选择成功后在取景态显示私有预览。
    const source = config.source ?? { kind: 'whiteboard' as const };
    if (source.kind !== 'whiteboard') {
      try {
        const stream = await acquireDisplayStream(source);
        const sourceSize = await getDisplayStreamPixelSize(stream);
        nextConfig = {
          ...nextConfig,
          source: {
            ...source,
            sourceSize,
          },
        };
        setSetupConfig(nextConfig);
        displayStreamRef.current = stream;
        setDisplayStream(stream);
      } catch (err) {
        setSetupOpen(true);
        alert(t('displaySourceFailed', { message: err instanceof Error ? err.message : 'unknown' }));
        return;
      }
    }
    // 预采集麦克风（在倒计时之前申请权限并就绪，供电平表 + 开录复用）
    micStreamRef.current?.getTracks().forEach((tk) => tk.stop());
    setMicStream(await acquireMicStream());
    setState('framing');
  }, [cameraStream, clearDisplayStream, t]);

  // 取景确认：校验摄像头在裁切框内 → 用当前相机位置/尺寸构建待开录参数 → 启动 3 秒倒计时
  const handleConfirmFraming = useCallback(() => {
    // 开了摄像头 + 固定比例 + 已有裁切框时，气泡必须完全落在框内才允许开录
    if (cameraEnabled && setupConfig.framing !== 'default') {
      const cw = cropWindowRef.current;
      const area = canvasAreaRef.current;
      if (cw && area) {
        const r = area.getBoundingClientRect();
        const fx = r.left + cw.rx * r.width;
        const fy = r.top + cw.ry * r.height;
        const fw = cw.rw * r.width;
        const fh = cw.rh * r.height;
        const EPS = 1;
        const inside =
          cameraPos.x >= fx - EPS &&
          cameraPos.y >= fy - EPS &&
          cameraPos.x + cameraSize <= fx + fw + EPS &&
          cameraPos.y + cameraSize <= fy + fh + EPS;
        if (!inside) {
          setFramingWarn(true);
          return; // 不进入倒计时
        }
      }
    }
    setFramingWarn(false);
    const selectedSource = setupConfig.source?.kind === 'selected_area'
      ? (() => {
          const crop = sourceCropWindow ?? { rx: 0.1, ry: 0.1, rw: 0.8, rh: 0.8 };
          return {
            ...setupConfig.source,
            sourceCropWindow: crop,
            sourceSize: sourceSizeForCrop(setupConfig.source.sourceSize, crop) ?? setupConfig.source.sourceSize,
          };
        })()
      : setupConfig.source;
    const finalConfig: RecordingSetupConfig = {
      ...setupConfig,
      source: selectedSource,
    };
    if (selectedSource?.kind && selectedSource.kind !== 'whiteboard') {
      // 在用户点击「开始录制」这一手势内请求 Document PiP，确保浏览器允许把控制条放到桌面上。
      void openDesktopControls();
    }
    pendingStartRef.current = { config: finalConfig, pos: cameraPos, size: cameraSize };
    setCountdown(3);
  }, [setupConfig, cameraPos, cameraSize, cameraEnabled, sourceCropWindow, openDesktopControls]);

  // 取景取消：停掉摄像头/麦克风预览、清裁切框、回 idle
  const handleCancelFraming = useCallback(() => {
    cameraStream?.getTracks().forEach((tk) => tk.stop());
    setCameraStream(null);
    micStreamRef.current?.getTracks().forEach((tk) => tk.stop());
    setMicStream(null);
    clearDisplayStream();
    closeDesktopControls();
    setCropWindow(null);
    setFramingWarn(false);
    setState('idle');
  }, [cameraStream, clearDisplayStream, closeDesktopControls]);

  // 倒计时：3→2→1→0 后真正开录
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const pending = pendingStartRef.current;
      pendingStartRef.current = null;
      setCountdown(null);
      if (pending) void beginRecording(pending.config, pending.pos, pending.size);
      return;
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown, beginRecording]);

  const handlePause = useCallback(() => {
    sessionRef.current?.pause();
    setState('paused');
  }, []);

  const handleResume = useCallback(() => {
    sessionRef.current?.resume();
    setState('recording');
  }, []);

  // 录制中麦克风 / 摄像头软静音状态（独立于 hasAudio / hasCamera —— 那两个表示设备是否启用）
  const [audioMuted, setAudioMuted] = useState(false);
  const [cameraMuted, setCameraMuted] = useState(false);

  const handleToggleAudioMute = useCallback(() => {
    const next = !audioMuted;
    sessionRef.current?.setAudioMuted(next);
    setAudioMuted(next);
  }, [audioMuted]);

  const handleToggleCameraMute = useCallback(async () => {
    // 三态循环（录制中）：off → on → muted → on …
    // off：开始录制时没勾摄像头 → 懒 acquire
    if (!hasCamera) {
      try {
        const ok = await sessionRef.current?.enableCamera();
        if (ok) {
          setHasCamera(true);
          setCameraMuted(false);
          setCameraStream(sessionRef.current?.cameraStream ?? null);
        }
      } catch (err) {
        alert(t('cameraOpenFailed', { message: err instanceof Error ? err.message : 'unknown' }));
      }
      return;
    }
    // on ↔ muted（既有路径）
    const next = !cameraMuted;
    setCameraMuted(next);
    if (next) setCameraStream(null);
    try {
      await sessionRef.current?.setCameraMuted(next);
    } catch { /* ignore：UI 状态已经反映 mute */ }
    if (!next) setCameraStream(sessionRef.current?.cameraStream ?? null);
  }, [hasCamera, cameraMuted, t]);

  // 激光笔：调 Excalidraw setActiveTool 切到 laser；再点切回 selection
  const handleToggleLaser = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    if (laserActive) {
      api.setActiveTool({ type: 'selection' });
      setLaserActive(false);
    } else {
      api.setActiveTool({ type: 'laser' });
      setLaserActive(true);
    }
  }, [laserActive]);

  const handleStop = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || stoppingRef.current) return;
    stoppingRef.current = true;
    setState('processing');
    try {
      const meta = await s.stop();
      trackEvent('recording_complete', { durationMs: meta.durationMs, framing: setupConfig.framing, hasCamera: meta.hasCamera, hasAudio: meta.hasAudio });
      // 持久化录制中最终框定的裁切框到 recording.setup（导出默认沿用）
      const cw = cropWindowRef.current;
      if (cw && setupConfig.framing !== 'default') {
        try {
          const { getClientDb } = await import('@/lib/db-client');
          await getClientDb().recordings.update(meta.id, {
            setup: {
              ...setupConfig,
              cropWindow: cw,
              ...(setupConfig.framing === 'custom' && customOutput ? { customOutput } : {}),
            },
          });
        } catch { /* 持久化失败不阻塞跳转 */ }
      }
      sessionRef.current = null;
      changeRef.current = null;
      laserPointRef.current = null;
      setCameraStream(null);
      clearDisplayStream();
      setHasCamera(false);
      setHasAudio(false);
      setAudioMuted(false);
      setCameraMuted(false);
      router.push(`/export/${meta.id}` as never);
      // Stop 可以从 Document PiP 的独立窗口触发。先把媒体收尾并发起主页面导航，
      // 再在下一轮事件循环释放控制窗口，避免销毁点击上下文导致导出页无法打开。
      window.setTimeout(closeDesktopControls, 0);
    } catch (err) {
      alert(t('stopFailed', { message: err instanceof Error ? err.message : 'unknown' }));
      sessionRef.current = null;
      changeRef.current = null;
      laserPointRef.current = null;
      clearDisplayStream();
      setState('idle');
    } finally {
      stoppingRef.current = false;
    }
  }, [router, t, setupConfig, customOutput, clearDisplayStream, closeDesktopControls]);

  const handleDiscard = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!confirm(t('discardConfirm'))) return;
    trackEvent('recording_discard');
    try {
      const meta = await s.stop();
      const { deleteRecording } = await import('@/lib/db-client');
      await deleteRecording(meta.id);
    } catch { /* ignore */ }
    sessionRef.current = null;
    changeRef.current = null;
    laserPointRef.current = null;
    setCameraStream(null);
    clearDisplayStream();
    closeDesktopControls();
    setHasCamera(false);
    setHasAudio(false);
    setState('idle');
  }, [t, clearDisplayStream, closeDesktopControls]);

  const isRecording = state === 'recording' || state === 'paused';
  // 显示源录制会直接采集浏览器画面。录制真正开始前，页内控制条必须撤出，
  // 只在 Document PiP 的独立文档中保留同一套完整控制条，避免录入最终素材。
  const usesExternalRecordingControls = state !== 'idle' && setupConfig.source?.kind !== 'whiteboard';
  const canDockRecordingBar = isRecording && !usesExternalRecordingControls;

  // 录制开始后将页内工具带收在画布右侧，避免长时间遮住白板；触碰窄标签即可
  // 在同一侧展开完整带。显示源录制走独立 Document PiP，因此不参与该行为。
  useEffect(() => {
    if (!canDockRecordingBar) {
      setRecordingBarDocked(false);
      return;
    }
    const id = window.setTimeout(() => setRecordingBarDocked(true), 1200);
    return () => window.clearTimeout(id);
  }, [canDockRecordingBar]);

  const revealRecordingBar = useCallback(() => setRecordingBarDocked(false), []);
  const dockRecordingBar = useCallback(() => {
    if (canDockRecordingBar && !draggingBar) setRecordingBarDocked(true);
  }, [canDockRecordingBar, draggingBar]);

  const recordingBarProps: RecordingBarProps = {
    state: state === 'framing' ? 'idle' : state,
    elapsedMs: elapsed,
    hasAudio,
    hasCamera: hasCamera || cameraEnabled,
    cameraEnabled,
    audioMuted,
    cameraMuted,
    laserActive,
    zoomActive: zoomMode,
    teleprompterActive: teleprompterOpen,
    aspect: isRecording ? setupConfig.framing : undefined,
    onToggleCamera: handleToggleCamera,
    onToggleAudioMute: handleToggleAudioMute,
    onToggleCameraMute: handleToggleCameraMute,
    onToggleLaser: handleToggleLaser,
    onToggleZoom: () => setZoomMode((value) => !value),
    onToggleTeleprompter: () => setTeleprompterOpen((value) => !value),
    onOpenTemplates: () => setLibraryOpen(true),
    onStart: handleStart,
    onStop: handleStop,
    onDiscard: handleDiscard,
    onPause: handlePause,
    onResume: handleResume,
  };
  // 只有“选定区域”需要在页面内显示源画面供用户拖拽裁切。
  // 桌面、窗口和标签页取景一律不挂回显层：即使用户误选本页面，也不会形成
  // 叠加的递归镜像；真正录制仍直接使用原始 display stream。
  const showLiveDisplayPreview = displayStream
    && setupConfig.source?.kind === 'selected_area'
    && state === 'framing'
    && countdown === null;

  return (
    <div className="app-craft-screen workspace-craft-shell flex h-full flex-col" ref={workspaceRootRef}>
      {/* AppHeader 全程可见，以便录制时被 shell capturer 抓到（之前会在录制时隐藏） */}
      <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      <div className="workspace-craft-canvas relative flex-1 overflow-hidden" ref={canvasAreaRef}>
        <Whiteboard
          onChangeRef={changeRef}
          onApiReady={(api) => { excalidrawApiRef.current = api; }}
          laserPointRef={laserPointRef}
        />

        {showLiveDisplayPreview && (
          <div data-testid="display-source-live-preview" className="rb-no-record absolute inset-0 z-10">
            <DisplaySourcePreview stream={displayStream} onAspectChange={setDisplayAspect} />
          </div>
        )}

        {displayStream && (state === 'framing' || isRecording) && setupConfig.source?.kind === 'selected_area' && (
          <DisplaySourceCropOverlay
            value={sourceCropWindow}
            mediaAspect={displayAspect}
            onChange={setSourceCropWindow}
            label={isRecording ? (en ? 'Recording selected area' : '正在录制选定区域') : (en ? 'Selected area' : '选定区域')}
            interactive={state === 'framing' && countdown === null}
          />
        )}

        {/* 裁切框 viewfinder：取景态 + 录制中显示（'default' 整画板不画） */}
        {(state === 'framing' || isRecording) && setupConfig.framing !== 'default' && setupConfig.source?.kind !== 'selected_area' && (
          <AspectCropOverlay
            framing={setupConfig.framing}
            value={cropWindow}
            onChange={setCropWindow}
            customOutput={customOutput}
            onCustomOutputChange={setCustomOutput}
            interactive={state === 'framing'}
          />
        )}

        {/* 摄像头浮窗：idle 期间用预览流；录制态如启用则用 session stream */}
        {(cameraEnabled || (isRecording && hasCamera)) && !cameraMuted && (
          <div className="rb-no-record">
            <CameraBubble
              stream={cameraStream}
              size={cameraSize}
              shape={cameraShape}
              position={cameraPos}
              onPositionChange={handleCameraPositionChange}
              onSizeChange={handleCameraSizeChange}
            />
          </div>
        )}

        {/* 取景控制条：取景态显示，用户框选/摆相机后点「开始录制」才进入倒计时 */}
        {state === 'framing' && countdown === null && (
          <div className="rb-no-record fixed left-1/2 bottom-7 z-[70] -translate-x-1/2">
            <FramingBar
              hint={t('framingHint')}
              startLabel={t('framingStart')}
              cancelLabel={t('framingCancel')}
              micStream={micStream}
              warn={framingWarn ? t('framingCameraOutside') : null}
              onStart={handleConfirmFraming}
              onCancel={handleCancelFraming}
            />
          </div>
        )}

        {/* 浮动录制条：position: fixed + 可拖拽，wrapper 不阻挡 Excalidraw 工具区点击 */}
        {barPos && state !== 'framing' && !usesExternalRecordingControls && (
          <div
            data-testid="in-page-recording-bar"
            data-docked={canDockRecordingBar && recordingBarDocked ? 'true' : 'false'}
            className="rb-no-record fixed z-30"
            style={canDockRecordingBar
              ? {
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  cursor: recordingBarDocked ? 'pointer' : 'default',
                  transition: 'opacity 160ms ease, transform 180ms ease',
                }
              : {
                  left: barPos.x,
                  top: barPos.y,
                  cursor: draggingBar ? 'grabbing' : 'grab',
                }}
            onPointerEnter={canDockRecordingBar ? revealRecordingBar : undefined}
            onPointerLeave={canDockRecordingBar ? dockRecordingBar : undefined}
            onMouseDown={canDockRecordingBar ? undefined : handleBarMouseDown}
            title={canDockRecordingBar ? undefined : t('dragToMove')}
          >
            {canDockRecordingBar && recordingBarDocked ? (
              <button
                type="button"
                data-testid="recording-bar-side-dock"
                onClick={revealRecordingBar}
                aria-label={en ? 'Show recording controls' : '展开录制工具条'}
                title={en ? 'Show recording controls' : '展开录制工具条'}
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  gap: 4,
                  minWidth: 48,
                  height: 72,
                  padding: '7px 9px 7px 11px',
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
                <span className={state === 'recording' ? 'recording-indicator' : ''} style={{ width: 8, height: 8, borderRadius: 999, background: state === 'recording' ? 'var(--rec)' : 'rgba(255,255,255,.52)' }} />
                <span style={{ fontSize: 10, fontWeight: 750, letterSpacing: '.04em' }}>{state === 'recording' ? 'REC' : 'II'}</span>
                <span style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', opacity: .86 }}>{formatRecordingElapsed(elapsed)}</span>
              </button>
            ) : <RecordingBar {...recordingBarProps} />}
          </div>
        )}

        <DesktopRecordingControls
          host={desktopControlHost}
          bar={usesExternalRecordingControls && isRecording ? recordingBarProps : null}
        />

        {/* 提词器浮层（私有，不进录制）；open=false 时返回 null */}
        <Teleprompter open={teleprompterOpen} onClose={() => setTeleprompterOpen(false)} en={en} autoFollow={isRecording && hasAudio && !audioMuted} micStream={micStream} />

        {paymentDone && (
          <div
            className="rb-no-record fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4 py-2"
            style={{
              background: 'var(--ok, #1a7f37)',
              color: '#fff',
              border: '1.4px solid var(--ink)',
              borderRadius: 4,
              boxShadow: '3px 3px 0 var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            {t('paymentReceived')}
          </div>
        )}

        {/* 自制 library 抽屉切换按钮：右上角浮动，独立于 Excalidraw 自带工具栏。
           对应的 LibraryDrawer 也独立挂在这一层 fixed 容器里。 */}
        <button
          type="button"
          onClick={() => setLibraryOpen((o) => !o)}
          title={t('libraryToggle')}
          className="workspace-craft-floating-button rb-no-record fixed right-3 top-16 z-30 grid place-items-center"
          style={{
            width: 34,
            height: 34,
            background: libraryOpen ? 'var(--hi)' : 'var(--paper)',
            border: '1.5px solid var(--ink)',
            borderRadius: 3,
            boxShadow: libraryOpen ? '2px 2px 0 var(--ink)' : 'none',
            color: 'var(--ink)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <I.Library size={16} />
        </button>
        {libraryOpen && (
          <LibraryDrawer
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            excalidrawApiRef={excalidrawApiRef}
          />
        )}

        {proUpgradeOpen && (
          <ProUpgradeModal
            open={proUpgradeOpen}
            onClose={() => setProUpgradeOpen(false)}
            onUpgraded={() => {
              void subscription.refresh();
            }}
          />
        )}

        {/* 录制前 Setup 面板 */}
        <RecordingSetup
          open={setupOpen}
          initial={setupConfig}
          onCancel={() => setSetupOpen(false)}
          onStart={handleSetupConfirm}
        />

        {/* 开录倒计时 3-2-1 */}
        {countdown !== null && countdown > 0 && (
          <div className="workspace-craft-countdown fade-in fixed inset-0 z-[60] grid place-items-center" style={{ background: 'rgba(26,26,26,0.55)' }}>
            <div
              className="workspace-craft-countdown-ring grid place-items-center"
              style={{
                width: 140, height: 140, borderRadius: '50%',
                background: 'var(--paper)', border: '2px solid var(--ink)',
                boxShadow: '6px 6px 0 var(--hi)',
                fontFamily: 'var(--font-display)', fontSize: 72, fontWeight: 700, color: 'var(--ink)',
              }}
            >
              {countdown}
            </div>
          </div>
        )}

        {/* 首次访问引导浮层 */}
        {showIntro && (
          <FirstRunGuide
            onClose={dismissIntro}
            onStartFromTemplate={() => {
              setLibraryOpen(true);
              dismissIntro();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** 取景态浮动控制条：提示 + 麦克风电平表（测音频）+ 取消 + 开始录制（→ 倒计时）。 */
function FramingBar({
  hint,
  startLabel,
  cancelLabel,
  micStream,
  warn,
  onStart,
  onCancel,
}: {
  hint: string;
  startLabel: string;
  cancelLabel: string;
  micStream: MediaStream | null;
  warn?: string | null;
  onStart: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div
      className="workspace-craft-framing flex items-center gap-3"
      style={{
        padding: '10px 14px',
        background: 'var(--paper)',
        border: '1.8px solid var(--ink)',
        borderRadius: 6,
        boxShadow: '4px 4px 0 var(--ink)',
      }}
    >
      {warn
        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--rec)', fontWeight: 600, letterSpacing: '0.02em' }}>{warn}</span>
        : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.02em' }}>{hint}</span>}
      <MicLevelMeter stream={micStream} />
      <button type="button" className="btn-sketch" onClick={onCancel} style={{ padding: '7px 14px' }}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className="btn-sketch btn-sketch-primary btn-stamp flex items-center"
        onClick={onStart}
        style={{ gap: 8, padding: '7px 16px' }}
      >
        <span className="rec-dot" style={{ width: 7, height: 7 }} />
        {startLabel}
      </button>
    </div>
  );
}

/** 实时麦克风电平表：AnalyserNode 读流的音量，8 根竖条按当前 level 点亮（测音频用）。 */
function MicLevelMeter({ stream }: { stream: MediaStream | null }): JSX.Element {
  const [level, setLevel] = useState(0); // 0..1

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) { setLevel(0); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255; // 归一化
      setLevel((prev) => Math.max(avg, prev * 0.8)); // 平滑回落
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch { /* ignore */ }
      void ctx.close();
    };
  }, [stream]);

  const bars = [0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];
  return (
    <div className="flex items-center" style={{ gap: 6, padding: '4px 8px', border: '1.4px solid var(--ink)', borderRadius: 3, background: 'var(--paper-2)' }}>
      <I.Mic size={13} />
      <div className="flex items-end" style={{ gap: 2, height: 14 }}>
        {bars.map((threshold, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 4 + i * 1.4,
              background: level >= threshold ? 'var(--ink)' : 'var(--rule-soft)',
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
