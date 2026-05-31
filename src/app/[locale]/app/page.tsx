'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AppHeader } from '@/components/AppHeader';
import { RecordingBar } from '@/components/RecordingBar';
import { CameraBubble } from '@/components/CameraBubble';
import { LibraryDrawer } from '@/components/LibraryDrawer';
import { I } from '@/components/icons';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { useSubscription } from '@/hooks/useSubscription';
import { startRecording, type SessionHandle } from '@/services/recordingSession';
import type { WhiteboardChangeFn } from '@/components/Whiteboard';
import { useRouter } from '@/i18n/navigation';

const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div>,
});

export default function HomePage(): JSX.Element {
  const t = useTranslations('workspace');
  const router = useRouter();
  const subscription = useSubscription();
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');
  const [elapsed, setElapsed] = useState<number>(0);
  const [hasAudio, setHasAudio] = useState<boolean>(false);
  const [hasCamera, setHasCamera] = useState<boolean>(false);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0 });
  const [cameraSize, setCameraSize] = useState(160);
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);

  // 录制条位置：默认放在 Excalidraw toolbar 之下、右上角，避开顶部菜单
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; barX: number; barY: number } | null>(null);
  const [draggingBar, setDraggingBar] = useState(false);

  const sessionRef = useRef<SessionHandle | null>(null);
  const changeRef = useRef<WhiteboardChangeFn | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workspaceRootRef = useRef<HTMLDivElement | null>(null);
  const cameraPosLsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraSizeLsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excalidrawApiRef = useRef<any>(null);
  const laserPointRef = useRef<((x: number, y: number, button: 'down' | 'up') => void) | null>(null);
  const [laserActive, setLaserActive] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);

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
  const handleCameraPositionChange = useCallback((p: { x: number; y: number }) => {
    setCameraPos(p);
    // 录制中：把 viewport 坐标 + 当前 size 喂给 session，写到 cameraPositions 表
    if (sessionRef.current) {
      sessionRef.current.recordCameraMove(p.x, p.y, cameraSize);
    }
    // UX：跨刷新记住位置（debounce 250ms 避免拖拽时写爆 localStorage）
    if (cameraPosLsTimerRef.current !== null) clearTimeout(cameraPosLsTimerRef.current);
    cameraPosLsTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('excalicast.camera-pos', JSON.stringify(p)); }
      catch { /* quota / private mode */ }
    }, 250);
  }, [cameraSize]);

  // 摄像头尺寸变更：(1) 录制中转发给 session（位置不变、size 变）；(2) debounced 写 localStorage
  const handleCameraSizeChange = useCallback((next: number) => {
    setCameraSize(next);
    if (sessionRef.current) {
      sessionRef.current.recordCameraMove(cameraPos.x, cameraPos.y, next);
    }
    if (cameraSizeLsTimerRef.current !== null) clearTimeout(cameraSizeLsTimerRef.current);
    cameraSizeLsTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('excalicast.camera-size', String(next)); }
      catch { /* quota / private mode */ }
    }, 250);
  }, [cameraPos.x, cameraPos.y]);

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

  const handleStart = useCallback(async () => {
    // 释放预览流（recordingSession 会重新申请，避免双流冲突）
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);

    try {
      const session = await startRecording({
        withCamera: cameraEnabled,
        workspaceRoot: workspaceRootRef.current,
      });
      sessionRef.current = session;
      changeRef.current = session.onWhiteboardChange;
      laserPointRef.current = session.recordLaserPoint;
      setHasAudio(session.hasAudio);
      setHasCamera(session.hasCamera);
      setCameraStream(session.cameraStream);
      setState('recording');
      // 录制开始时种一颗 t=0 事件，保证回放/导出能定位到当前气泡位置，
      // 而不是回退到默认右下角
      if (session.hasCamera) {
        session.recordCameraMove(cameraPos.x, cameraPos.y, cameraSize);
      }
    } catch (err) {
      alert(t('startFailed', { message: err instanceof Error ? err.message : 'unknown' }));
    }
  }, [cameraEnabled, cameraStream, cameraPos, cameraSize, t]);

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
    if (!s) return;
    setState('processing');
    try {
      const meta = await s.stop();
      sessionRef.current = null;
      changeRef.current = null;
      laserPointRef.current = null;
      setCameraStream(null);
      setHasCamera(false);
      setHasAudio(false);
      setAudioMuted(false);
      setCameraMuted(false);
      setState('idle');
      router.push(`/export/${meta.id}` as never);
    } catch (err) {
      alert(t('stopFailed', { message: err instanceof Error ? err.message : 'unknown' }));
      sessionRef.current = null;
      changeRef.current = null;
      laserPointRef.current = null;
      setState('idle');
    }
  }, [router, t]);

  const handleDiscard = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!confirm(t('discardConfirm'))) return;
    try {
      const meta = await s.stop();
      const { deleteRecording } = await import('@/lib/db-client');
      await deleteRecording(meta.id);
    } catch { /* ignore */ }
    sessionRef.current = null;
    changeRef.current = null;
    laserPointRef.current = null;
    setCameraStream(null);
    setHasCamera(false);
    setHasAudio(false);
    setState('idle');
  }, [t]);

  const isRecording = state === 'recording' || state === 'paused';

  return (
    <div className="flex h-full flex-col" ref={workspaceRootRef}>
      {/* AppHeader 全程可见，以便录制时被 shell capturer 抓到（之前会在录制时隐藏） */}
      <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      <div className="relative flex-1 overflow-hidden">
        <Whiteboard
          onChangeRef={changeRef}
          onApiReady={(api) => { excalidrawApiRef.current = api; }}
          laserPointRef={laserPointRef}
        />

        {/* 摄像头浮窗：idle 期间用预览流；录制态如启用则用 session stream */}
        {(cameraEnabled || (isRecording && hasCamera)) && !cameraMuted && (
          <div className="rb-no-record">
            <CameraBubble
              stream={cameraStream}
              size={cameraSize}
              shape="circle"
              position={cameraPos}
              onPositionChange={handleCameraPositionChange}
              onSizeChange={handleCameraSizeChange}
            />
          </div>
        )}

        {/* 浮动录制条：position: fixed + 可拖拽，wrapper 不阻挡 Excalidraw 工具区点击 */}
        {barPos && (
          <div
            className="rb-no-record fixed z-30"
            style={{
              left: barPos.x,
              top: barPos.y,
              cursor: draggingBar ? 'grabbing' : 'grab',
            }}
            onMouseDown={handleBarMouseDown}
            title={t('dragToMove')}
          >
            <RecordingBar
              state={state}
              elapsedMs={elapsed}
              hasAudio={hasAudio}
              hasCamera={hasCamera || cameraEnabled}
              cameraEnabled={cameraEnabled}
              audioMuted={audioMuted}
              cameraMuted={cameraMuted}
              laserActive={laserActive}
              onToggleCamera={handleToggleCamera}
              onToggleAudioMute={handleToggleAudioMute}
              onToggleCameraMute={handleToggleCameraMute}
              onToggleLaser={handleToggleLaser}
              onStart={handleStart}
              onStop={handleStop}
              onDiscard={handleDiscard}
              onPause={handlePause}
              onResume={handleResume}
            />
          </div>
        )}

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
          className="rb-no-record fixed right-3 top-16 z-30 grid place-items-center"
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
        <LibraryDrawer
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          excalidrawApiRef={excalidrawApiRef}
        />

        <ProUpgradeModal
          open={proUpgradeOpen}
          onClose={() => setProUpgradeOpen(false)}
          onUpgraded={() => {
            void subscription.refresh();
          }}
        />
      </div>
    </div>
  );
}
