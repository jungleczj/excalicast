'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/AppHeader';
import { CameraBubble } from '@/components/CameraBubble';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { RecordSetupModal, type RecordSetupValues } from '@/components/RecordSetupModal';
import { ScreenRecordingBar } from '@/components/ScreenRecordingBar';
import { useSubscription } from '@/hooks/useSubscription';
import { startScreenRecording, type ScreenRecordingHandle } from '@/services/screenRecording';
import { deleteScreenRecording } from '@/lib/db-client';
import { useRouter } from '@/i18n/navigation';

const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div>,
});

const INITIAL_CAMERA_POS = (): { x: number; y: number } => ({
  x: typeof window !== 'undefined' ? window.innerWidth - 200 : 1700,
  y: typeof window !== 'undefined' ? window.innerHeight - 280 : 800,
});

export default function HomePage(): JSX.Element {
  const router = useRouter();
  const subscription = useSubscription();
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);

  // 屏幕录制状态
  const [setupOpen, setSetupOpen] = useState(false);
  const screenSessionRef = useRef<ScreenRecordingHandle | null>(null);
  const [screenState, setScreenState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');

  // 当处于录制/暂停时显示的摄像头浮窗状态
  const [activeCameraStream, setActiveCameraStream] = useState<MediaStream | null>(null);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number }>(INITIAL_CAMERA_POS);
  const [showLiveBubble, setShowLiveBubble] = useState(false);

  // Ensure default position is correct after first paint
  useEffect(() => {
    setCameraPos(INITIAL_CAMERA_POS());
  }, []);

  const updateCameraPos = useCallback((next: { x: number; y: number }) => {
    setCameraPos(next);
    screenSessionRef.current?.setCameraPosition(next);
  }, []);

  const handleConfirmSetup = useCallback(async (vals: RecordSetupValues) => {
    setSetupOpen(false);
    try {
      const handle = await startScreenRecording({
        withMic: vals.withMic,
        withSystemAudio: vals.withSystemAudio,
        withCamera: vals.withCamera,
        cameraSizePx: 160,
        initialCameraPosition: INITIAL_CAMERA_POS(),
      });
      screenSessionRef.current = handle;

      // Decide whether to show a live DOM camera bubble during recording.
      // If the user picked the 'browser' surface (some Chrome tab — possibly
      // ours), showing a DOM bubble would cause double-bubble recursion in
      // the recorded output. In that case, hide the DOM bubble. The bubble
      // still appears in the final video via the liveComposite canvas draw.
      if (handle.hasCamera && handle.cameraStream && handle.displaySurface !== 'browser') {
        setActiveCameraStream(handle.cameraStream);
        setShowLiveBubble(true);
      } else {
        setActiveCameraStream(null);
        setShowLiveBubble(false);
      }

      setScreenState('recording');

      // Surface degraded-permission cases so the user understands what they got
      const warnings: string[] = [];
      if (vals.withMic && !handle.hasMic) {
        warnings.push(`麦克风未启用：${handle.micError || '权限被拒绝或设备不可用'}`);
      }
      if (vals.withCamera && !handle.hasCamera) {
        warnings.push(`摄像头未启用：${handle.cameraError || '权限被拒绝或设备不可用'}（macOS 需在 系统设置 → 隐私与安全性 → 摄像头 里允许浏览器）`);
      }
      if (vals.withSystemAudio && !handle.hasSystemAudio) {
        warnings.push('系统音频未捕获：可能你选了「应用窗口」(只能选「整个屏幕」或某个标签页才能捕获系统音频)');
      }
      // Tell the user we hid the live bubble for safety
      if (handle.hasCamera && handle.displaySurface === 'browser') {
        warnings.push('录制源是浏览器标签页：为避免摄像头气泡在视频里出现两次，已隐藏页面上的实时气泡预览。最终视频里气泡仍然存在（合成层负责绘制）。');
      }
      if (warnings.length > 0) {
        setTimeout(() => alert(warnings.join('\n\n')), 100);
      }
    } catch (err) {
      alert(`无法开始录制：${err instanceof Error ? err.message : 'unknown'}`);
    }
  }, []);

  const handlePause = useCallback(() => {
    screenSessionRef.current?.pause();
    setScreenState('paused');
  }, []);

  const handleResume = useCallback(() => {
    screenSessionRef.current?.resume();
    setScreenState('recording');
  }, []);

  const cleanupBubble = useCallback(() => {
    setActiveCameraStream(null);
    setShowLiveBubble(false);
  }, []);

  const handleStop = useCallback(async () => {
    const handle = screenSessionRef.current;
    if (!handle) return;
    setScreenState('processing');
    // IMMEDIATELY hide the bubble — don't wait for handle.stop() to finish.
    // handle.stop() polls IndexedDB for up to 5s; during that time we should
    // not leave a stale bubble on screen.
    cleanupBubble();
    try {
      const meta = await handle.stop();
      screenSessionRef.current = null;
      setScreenState('idle');
      router.push(`/process/${meta.id}` as never);
    } catch (err) {
      alert(`停止录制失败：${err instanceof Error ? err.message : 'unknown'}`);
      screenSessionRef.current = null;
      setScreenState('idle');
    }
  }, [router, cleanupBubble]);

  const handleDiscard = useCallback(async () => {
    if (!confirm('丢弃这次录制？已录制的内容将被删除。')) return;
    const handle = screenSessionRef.current;
    if (!handle) return;
    cleanupBubble();
    try {
      const meta = await handle.stop();
      await deleteScreenRecording(meta.id);
    } catch { /* ignore */ }
    screenSessionRef.current = null;
    setScreenState('idle');
  }, [cleanupBubble]);

  const isActive = screenState === 'recording' || screenState === 'paused';

  return (
    <div className="flex h-full flex-col">
      <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      <div className="relative flex-1 overflow-hidden">
        <Whiteboard onChangeRef={{ current: null }} />

        {/*
          录制期间的摄像头实时预览：
          - 只在 isActive + showLiveBubble (即 displaySurface !== 'browser') 时显示
          - 让用户看到自己的脸，作为正在录制的视觉反馈
          - 在 'browser' 录制源场景下故意隐藏，避免气泡在最终视频里出现两次
        */}
        {isActive && showLiveBubble && activeCameraStream && (
          <CameraBubble
            stream={activeCameraStream}
            size={160}
            shape="circle"
            position={cameraPos}
            onPositionChange={updateCameraPos}
          />
        )}

        {/* idle 状态：底部居中的「开始录制」按钮 */}
        {screenState === 'idle' && (
          <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white shadow-md"
              style={{ background: 'var(--recording-strong)' }}
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              开始录制
            </button>
          </div>
        )}

        {/* 录制 / 暂停状态：底部居中的浮动控制条 */}
        {isActive && (
          <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
            <ScreenRecordingBar
              state={screenState === 'recording' ? 'recording' : 'paused'}
              getElapsedMs={() => screenSessionRef.current?.getElapsedMs() ?? 0}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              onDiscard={handleDiscard}
            />
          </div>
        )}

        <RecordSetupModal
          open={setupOpen}
          onCancel={() => setSetupOpen(false)}
          onConfirm={handleConfirmSetup}
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
