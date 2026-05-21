'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/AppHeader';
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

  const [setupOpen, setSetupOpen] = useState(false);
  const screenSessionRef = useRef<ScreenRecordingHandle | null>(null);
  const [screenState, setScreenState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');

  const handleConfirmSetup = useCallback(async (vals: RecordSetupValues) => {
    setSetupOpen(false);
    try {
      const handle = await startScreenRecording({
        withMic: vals.withMic,
        withSystemAudio: vals.withSystemAudio,
        withCamera: vals.withCamera,
      });
      screenSessionRef.current = handle;
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
        warnings.push('系统音频未捕获：仅在「整个屏幕」（需在选择器勾「分享音频」）/「标签页」下可用；macOS Chrome 不支持「应用窗口」的系统音频');
      }
      if (vals.withCamera && handle.hasCamera && !handle.previewActive) {
        warnings.push('摄像头实时预览未启动：浏览器拒绝了 Picture-in-Picture。录制中你看不到自己脸，但最终视频里会有气泡。');
      }
      if (handle.bubbleSource === 'in_screen') {
        warnings.push('「整个屏幕」录制：摄像头浮窗已被录入屏幕，位置由你拖动 PiP 决定。处理页不能再 reposition。仅支持单显示器。');
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

  const handleStop = useCallback(async () => {
    const handle = screenSessionRef.current;
    if (!handle) return;
    setScreenState('processing');
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
    setScreenState('idle');
  }, []);

  const isActive = screenState === 'recording' || screenState === 'paused';

  return (
    <div className="flex h-full flex-col">
      <AppHeader tier={subscription.tier} onUpgradePro={() => setProUpgradeOpen(true)} />
      <div className="relative flex-1 overflow-hidden">
        <Whiteboard onChangeRef={{ current: null }} />

        {/*
          摄像头实时预览：由 cameraPreviewPip 服务弹出 OS 级 Picture-in-Picture 浮窗，
          完全独立于本页 DOM。
          - 录 tab / 录 window 时：PiP 不被 capture 抓到 → 最终视频靠 ffmpeg overlay
          - 录整屏（monitor）时：PiP 会被一起录进 screen.webm → export 跳过 overlay
          页面这里不再渲染任何 CameraBubble。任何场景下：录制视频中气泡 = 恰好 1 个。
        */}

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
