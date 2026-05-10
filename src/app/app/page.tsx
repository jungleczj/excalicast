'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { RecordingBar } from '@/components/RecordingBar';
import { CameraBubble } from '@/components/CameraBubble';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { useSubscription } from '@/hooks/useSubscription';
import { startRecording, type SessionHandle } from '@/services/recordingSession';
import type { WhiteboardChangeFn } from '@/components/Whiteboard';
import { FREE_DURATION_LIMIT_MS, FREE_DURATION_WARN_MS } from '@/types/user';

const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-text-tertiary">加载白板…</div>,
});

export default function HomePage(): JSX.Element {
  const router = useRouter();
  const subscription = useSubscription();
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');
  const [elapsed, setElapsed] = useState<number>(0);
  const [hasAudio, setHasAudio] = useState<boolean>(false);
  const [hasCamera, setHasCamera] = useState<boolean>(false);
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0 });
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);
  const [showDurationWarn, setShowDurationWarn] = useState(false);
  const autoStoppedRef = useRef(false);

  // 录制条位置：默认放在 Excalidraw toolbar 之下、右上角，避开顶部菜单
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; barX: number; barY: number } | null>(null);
  const [draggingBar, setDraggingBar] = useState(false);

  const sessionRef = useRef<SessionHandle | null>(null);
  const changeRef = useRef<WhiteboardChangeFn | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 初始化摄像头位置（右下角，避开录制条）
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    setCameraPos({ x: w - 200, y: h - 280 });

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
      tickRef.current = setInterval(() => {
        if (sessionRef.current) setElapsed(sessionRef.current.getElapsedMs());
      }, 250);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }
    if (state === 'idle') {
      setElapsed(0);
      setShowDurationWarn(false);
      autoStoppedRef.current = false;
    }
  }, [state]);

  // 时长限制：免费版到 25min 警告，到 30min 自动停止并弹 Pro 升级
  // Pro/Max 不受限
  useEffect(() => {
    if (subscription.permissions.unlimitedDuration) return;
    if (state !== 'recording' && state !== 'paused') return;
    if (elapsed >= FREE_DURATION_WARN_MS && !showDurationWarn) {
      setShowDurationWarn(true);
    }
    if (elapsed >= FREE_DURATION_LIMIT_MS && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      setProUpgradeOpen(true);
      // 自动停止：保存完整数据，之后用户可决定升级 Pro 继续录新的
      void handleStopRef.current?.();
    }
  }, [elapsed, state, subscription.permissions.unlimitedDuration, showDurationWarn]);

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
      alert(`无法打开摄像头：${err instanceof Error ? err.message : 'unknown'}`);
    }
  }, [cameraEnabled, cameraStream, state]);

  const handleStart = useCallback(async () => {
    // 释放预览流（recordingSession 会重新申请，避免双流冲突）
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);

    try {
      const session = await startRecording({ withCamera: cameraEnabled });
      sessionRef.current = session;
      changeRef.current = session.onWhiteboardChange;
      setHasAudio(session.hasAudio);
      setHasCamera(session.hasCamera);
      setCameraStream(session.cameraStream);
      setState('recording');
    } catch (err) {
      alert(`开始录制失败：${err instanceof Error ? err.message : 'unknown'}`);
    }
  }, [cameraEnabled, cameraStream]);

  const handlePause = useCallback(() => {
    sessionRef.current?.pause();
    setState('paused');
  }, []);

  const handleResume = useCallback(() => {
    sessionRef.current?.resume();
    setState('recording');
  }, []);

  const handleStop = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setState('processing');
    try {
      const meta = await s.stop();
      sessionRef.current = null;
      changeRef.current = null;
      setCameraStream(null);
      setHasCamera(false);
      setHasAudio(false);
      setState('idle');
      router.push(`/export/${meta.id}`);
    } catch (err) {
      alert(`停止录制失败：${err instanceof Error ? err.message : 'unknown'}`);
      sessionRef.current = null;
      changeRef.current = null;
      setState('idle');
    }
  }, [router]);
  const handleStopRef = useRef<typeof handleStop | null>(null);
  useEffect(() => { handleStopRef.current = handleStop; }, [handleStop]);

  const handleDiscard = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!confirm('丢弃当前录制？所有数据将被删除。')) return;
    try {
      const meta = await s.stop();
      const { deleteRecording } = await import('@/lib/db-client');
      await deleteRecording(meta.id);
    } catch { /* ignore */ }
    sessionRef.current = null;
    changeRef.current = null;
    setCameraStream(null);
    setHasCamera(false);
    setHasAudio(false);
    setState('idle');
  }, []);

  const isRecording = state === 'recording' || state === 'paused';

  return (
    <div className="flex h-full flex-col">
      {/* 录制中隐藏顶部 nav，让画板 + 录制条独占屏幕 */}
      {!isRecording && state !== 'processing' && (
        <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      )}
      <div className="relative flex-1 overflow-hidden">
        <Whiteboard onChangeRef={changeRef} />

        {/* 摄像头浮窗：idle 期间用预览流；录制态如启用则用 session stream */}
        {(cameraEnabled || (isRecording && hasCamera)) && (
          <CameraBubble
            stream={cameraStream}
            size={160}
            shape="circle"
            position={cameraPos}
            onPositionChange={setCameraPos}
          />
        )}

        {/* 时长警告 banner（免费版接近 30min 上限） */}
        {showDurationWarn && isRecording && !subscription.permissions.unlimitedDuration && (
          <div
            className="fixed left-1/2 top-4 z-40 flex items-center gap-3 rounded-full px-4 py-2 text-[12px] text-white"
            style={{
              transform: 'translateX(-50%)',
              background: 'linear-gradient(90deg, #f59e0b, #ea580c)',
              boxShadow: '0 8px 24px rgba(234,88,12,0.4)',
            }}
          >
            <span>
              免费版剩余 {Math.max(0, Math.ceil((FREE_DURATION_LIMIT_MS - elapsed) / 60000))} 分钟，到时自动停止
            </span>
            <button
              type="button"
              onClick={() => setProUpgradeOpen(true)}
              className="rounded-full bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
            >
              升级 Pro 解除限制
            </button>
            <button
              type="button"
              onClick={() => setShowDurationWarn(false)}
              className="grid h-5 w-5 place-items-center rounded-full bg-white/15 hover:bg-white/25"
            >
              ✕
            </button>
          </div>
        )}

        {/* 浮动录制条：position: fixed + 可拖拽，wrapper 不阻挡 Excalidraw 工具区点击 */}
        {barPos && (
          <div
            className="fixed z-30"
            style={{
              left: barPos.x,
              top: barPos.y,
              cursor: draggingBar ? 'grabbing' : 'grab',
            }}
            onMouseDown={handleBarMouseDown}
            title="拖动以移动"
          >
            <RecordingBar
              state={state}
              elapsedMs={elapsed}
              hasAudio={hasAudio}
              hasCamera={hasCamera || cameraEnabled}
              cameraEnabled={cameraEnabled}
              onToggleCamera={handleToggleCamera}
              onStart={handleStart}
              onStop={handleStop}
              onDiscard={handleDiscard}
              onPause={handlePause}
              onResume={handleResume}
            />
          </div>
        )}

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
