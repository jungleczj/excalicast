'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AppHeader } from '@/components/AppHeader';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import {
  RecordSetupModal,
  type RecordSetupValues,
  type WaitingState,
} from '@/components/RecordSetupModal';
import { ScreenRecordingBar } from '@/components/ScreenRecordingBar';
import { MacOSPermissionHelp } from '@/components/MacOSPermissionHelp';
import { useSubscription } from '@/hooks/useSubscription';
import { startScreenRecording, type ScreenRecordingHandle } from '@/services/screenRecording';
import { SCREEN_ERROR, type ScreenError, type AbortFlag } from '@/services/displayCapture';
import { deleteScreenRecording } from '@/lib/db-client';
import { useRouter } from '@/i18n/navigation';

const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-text-tertiary">…</div>,
});

function stopStream(s: MediaStream | null): void {
  if (!s) return;
  try { s.getTracks().forEach((t) => t.stop()); } catch { /* */ }
}

export default function HomePage(): JSX.Element {
  const router = useRouter();
  const subscription = useSubscription();
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);

  const [setupOpen, setSetupOpen] = useState(false);
  const [waitingState, setWaitingState] = useState<WaitingState>({ kind: 'idle' });
  const [showMacOSHelp, setShowMacOSHelp] = useState(false);
  const abortFlagRef = useRef<AbortFlag>({ aborted: false });
  const inflightStreamsRef = useRef<{ micStream: MediaStream | null; cameraStream: MediaStream | null }>({
    micStream: null,
    cameraStream: null,
  });

  const screenSessionRef = useRef<ScreenRecordingHandle | null>(null);
  const [screenState, setScreenState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');

  const handleConfirmSetup = useCallback(async (vals: RecordSetupValues) => {
    // The modal stays open during waiting — we don't call setSetupOpen(false).
    abortFlagRef.current = { aborted: false };
    inflightStreamsRef.current = { micStream: vals.micStream, cameraStream: vals.cameraStream };
    setWaitingState({ kind: 'waiting_picker' });

    try {
      const handle = await startScreenRecording({
        withSystemAudio: vals.withSystemAudio,
        presetMicStream: vals.micStream,
        presetCameraStream: vals.cameraStream,
        abortFlag: abortFlagRef.current,
      });
      // Recording owns the streams now — clear our local refs so we don't
      // double-stop them on cancel.
      inflightStreamsRef.current = { micStream: null, cameraStream: null };
      screenSessionRef.current = handle;
      setWaitingState({ kind: 'idle' });
      setSetupOpen(false);
      setScreenState('recording');

      // Surface degraded-permission cases (preset streams may differ from toggles)
      const warnings: string[] = [];
      if (vals.withSystemAudio && !handle.hasSystemAudio) {
        warnings.push('系统音频未捕获：仅在「整个屏幕」（需在选择器勾「分享音频」）/「标签页」下可用；macOS Chrome 不支持「应用窗口」的系统音频');
      }
      if (vals.withCamera && handle.hasCamera && !handle.previewActive) {
        warnings.push('摄像头实时预览未启动：浏览器拒绝了 Picture-in-Picture。录制中你看不到自己脸，但最终视频里仍会有气泡。');
      }
      if (handle.bubbleSource === 'in_screen') {
        warnings.push('「整个屏幕」录制：摄像头浮窗已被录入屏幕，位置由你拖动 PiP 决定。处理页不能再 reposition。仅支持单显示器。');
      }
      if (warnings.length > 0) {
        setTimeout(() => alert(warnings.join('\n\n')), 100);
      }
    } catch (err) {
      const code = (err as ScreenError | undefined)?.code;
      // Recording didn't start; we still own the preset streams. Release them.
      stopStream(inflightStreamsRef.current.micStream);
      stopStream(inflightStreamsRef.current.cameraStream);
      inflightStreamsRef.current = { micStream: null, cameraStream: null };

      if (code === SCREEN_ERROR.PICKER_CANCELLED) {
        // Quietly return to the setup panel; user can retry.
        setWaitingState({ kind: 'idle' });
        // But also close the modal so they don't get stuck — they had a chance
        // to pick and bailed.
        setSetupOpen(false);
      } else if (code === SCREEN_ERROR.BLACK_FRAMES) {
        setSetupOpen(false);
        setWaitingState({ kind: 'idle' });
        setShowMacOSHelp(true);
      } else if (code === SCREEN_ERROR.NO_VIDEO_TRACK) {
        setSetupOpen(false);
        setWaitingState({ kind: 'idle' });
        alert('录制启动失败：浏览器没有返回视频轨。请重试，或检查 Chrome 是否有屏幕录制权限。');
      } else {
        setSetupOpen(false);
        setWaitingState({ kind: 'idle' });
        alert(`无法开始录制：${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }, []);

  const handleCancelSetup = useCallback(() => {
    // Cancel before clicking "选择录制源" — no streams handed off yet, the
    // modal's own cleanup releases what it has.
    setSetupOpen(false);
    setWaitingState({ kind: 'idle' });
  }, []);

  const handleCancelWaiting = useCallback(() => {
    // The user gave up while the OS picker is open. Signal abort; the recording
    // start function will detect it and reject with PICKER_CANCELLED, after
    // which our catch above releases everything.
    abortFlagRef.current.aborted = true;
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

        {screenState === 'idle' && !setupOpen && (
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
          waitingState={waitingState}
          onCancel={handleCancelSetup}
          onConfirm={handleConfirmSetup}
          onCancelWaiting={handleCancelWaiting}
        />

        {showMacOSHelp && (
          <div
            className="fixed inset-0 z-50 grid place-items-center"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
            onClick={() => setShowMacOSHelp(false)}
          >
            <div
              className="w-[520px] max-w-[92vw] rounded-2xl bg-bg-primary p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MacOSPermissionHelp />
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowMacOSHelp(false)}
                  className="rounded-md border border-border-default px-4 py-2 text-[13px] font-semibold text-text-secondary hover:bg-bg-tertiary"
                >
                  知道了
                </button>
              </div>
            </div>
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
