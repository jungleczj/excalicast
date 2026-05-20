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

export default function HomePage(): JSX.Element {
  const router = useRouter();
  const subscription = useSubscription();
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);

  // 屏幕录制状态
  const [setupOpen, setSetupOpen] = useState(false);
  const screenSessionRef = useRef<ScreenRecordingHandle | null>(null);
  const [screenState, setScreenState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // 摄像头气泡默认右下角
    setCameraPos({ x: window.innerWidth - 200, y: window.innerHeight - 280 });
  }, []);

  // 拖动摄像头气泡时，回写到 live composite 让最终视频里也跟着动
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
        initialCameraPosition: {
          x: window.innerWidth - 200,
          y: window.innerHeight - 280,
        },
      });
      screenSessionRef.current = handle;
      setCameraStream(handle.cameraStream);
      setScreenState('recording');
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

  const handleStop = useCallback(async () => {
    const handle = screenSessionRef.current;
    if (!handle) return;
    setScreenState('processing');
    try {
      const meta = await handle.stop();
      screenSessionRef.current = null;
      setCameraStream(null);
      setScreenState('idle');
      router.push(`/process/${meta.id}` as never);
    } catch (err) {
      alert(`停止录制失败：${err instanceof Error ? err.message : 'unknown'}`);
      screenSessionRef.current = null;
      setCameraStream(null);
      setScreenState('idle');
    }
  }, [router]);

  const handleDiscard = useCallback(async () => {
    if (!confirm('丢弃这次录制？已录制的内容将被删除。')) return;
    const handle = screenSessionRef.current;
    if (!handle) return;
    try {
      const meta = await handle.stop();
      await deleteScreenRecording(meta.id);
    } catch { /* ignore */ }
    screenSessionRef.current = null;
    setCameraStream(null);
    setScreenState('idle');
  }, []);

  const isActive = screenState === 'recording' || screenState === 'paused';

  return (
    <div className="flex h-full flex-col">
      <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      <div className="relative flex-1 overflow-hidden">
        <Whiteboard onChangeRef={{ current: null }} />

        {/* 摄像头气泡：录制中可拖动，位置实时反映到合成视频里 */}
        {isActive && screenSessionRef.current?.hasCamera && cameraStream && (
          <CameraBubble
            stream={cameraStream}
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
