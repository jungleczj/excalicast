'use client';

import { useCallback, useEffect, useState } from 'react';
import { I } from '@/components/icons';
import { CameraPreview } from '@/components/CameraPreview';
import { MicLevelMeter } from '@/components/MicLevelMeter';
import { MacOSPermissionHelp } from '@/components/MacOSPermissionHelp';
import { useSetupStreams, type SetupStreamsApi } from '@/hooks/useSetupStreams';

export interface RecordSetupValues {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
  /** Preset streams handed off to the recording layer. The receiver takes
   *  ownership and is responsible for stopping the tracks. */
  micStream: MediaStream | null;
  cameraStream: MediaStream | null;
}

export type WaitingState =
  | { kind: 'idle' }
  | { kind: 'waiting_picker' }
  | { kind: 'waiting_picker_long' };

interface Props {
  open: boolean;
  /** When non-idle, the modal stays open but in a frozen state showing the
   *  spinner + cancel button. */
  waitingState: WaitingState;
  onCancel: () => void;
  /** Called when the user clicks "选择录制源". The handler is async; while
   *  it resolves the parent flips waitingState to 'waiting_picker'. */
  onConfirm: (values: RecordSetupValues) => void;
  /** Called by the cancel button while waitingState is non-idle. */
  onCancelWaiting: () => void;
}

const WAITING_LONG_MS = 30_000;

export function RecordSetupModal({
  open,
  waitingState,
  onCancel,
  onConfirm,
  onCancelWaiting,
}: Props): JSX.Element | null {
  const [withMic, setWithMic] = useState(true);
  const [withSystemAudio, setWithSystemAudio] = useState(false);
  const [withCamera, setWithCamera] = useState(false);

  const streams = useSetupStreams();

  // Preflight: when the modal opens and a toggle defaults to ON, we still
  // wait for the user to interact to avoid unexpected permission prompts on
  // page entry. So no auto-request here.

  // Cleanup undetached streams when the modal CLOSES without starting a
  // recording. The hook's unmount cleanup handles the case where the parent
  // unmounts us; this handles toggling `open` to false.
  useEffect(() => {
    if (!open) {
      streams.releaseAll();
    }
    // intentionally only depends on `open`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 30s long-wait indicator while picker is up.
  const [showLongWaitHelp, setShowLongWaitHelp] = useState(false);
  useEffect(() => {
    if (waitingState.kind !== 'waiting_picker') {
      setShowLongWaitHelp(false);
      return;
    }
    const t = setTimeout(() => setShowLongWaitHelp(true), WAITING_LONG_MS);
    return () => clearTimeout(t);
  }, [waitingState.kind]);

  const handleToggleMic = useCallback(async (next: boolean) => {
    if (waitingState.kind !== 'idle') return;
    setWithMic(next);
    if (next) {
      await streams.requestMic();
      // If permission was denied, reset toggle so user sees the inline error
      // is the reason it's off.
      if (!streams.micStream && streams.micError) {
        // useSetupStreams keeps the error and stream nulled; we keep the
        // toggle "on" so the user sees they tried — and the inline error
        // explains why it didn't work. That's better than silently flipping
        // it back to off.
      }
    } else {
      streams.releaseMic();
    }
  }, [waitingState.kind, streams]);

  const handleToggleCamera = useCallback(async (next: boolean) => {
    if (waitingState.kind !== 'idle') return;
    setWithCamera(next);
    if (next) {
      await streams.requestCamera();
    } else {
      streams.releaseCamera();
    }
  }, [waitingState.kind, streams]);

  const handleConfirm = useCallback(() => {
    if (waitingState.kind !== 'idle') return;
    // Hand the streams to the recording layer. The hook stops tracking them
    // so its unmount cleanup won't kill the live recording.
    const { micStream, cameraStream } = streams.detachAll();
    onConfirm({
      withMic: withMic && !!micStream,
      withSystemAudio,
      withCamera: withCamera && !!cameraStream,
      micStream,
      cameraStream,
    });
  }, [streams, withMic, withSystemAudio, withCamera, waitingState.kind, onConfirm]);

  if (!open) return null;

  const isWaiting = waitingState.kind !== 'idle';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={isWaiting ? undefined : onCancel}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-2xl bg-bg-primary p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {isWaiting ? (
          <WaitingPanel
            showLongHelp={showLongWaitHelp || waitingState.kind === 'waiting_picker_long'}
            onCancel={onCancelWaiting}
          />
        ) : (
          <SetupPanel
            withMic={withMic}
            withSystemAudio={withSystemAudio}
            withCamera={withCamera}
            onToggleMic={handleToggleMic}
            onToggleSysAudio={setWithSystemAudio}
            onToggleCamera={handleToggleCamera}
            onCancel={onCancel}
            onConfirm={handleConfirm}
            streams={streams}
          />
        )}
      </div>
    </div>
  );
}

function SetupPanel({
  withMic,
  withSystemAudio,
  withCamera,
  onToggleMic,
  onToggleSysAudio,
  onToggleCamera,
  onCancel,
  onConfirm,
  streams,
}: {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
  onToggleMic: (v: boolean) => void;
  onToggleSysAudio: (v: boolean) => void;
  onToggleCamera: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  streams: SetupStreamsApi;
}): JSX.Element {
  return (
    <>
      <h2 className="mb-4 text-[18px] font-bold text-text-primary">开始录制</h2>

      <ToggleWithRail
        label="麦克风"
        desc="录入你说的话"
        icon={<I.Mic size={18} />}
        checked={withMic}
        onChange={onToggleMic}
        pending={streams.micPending}
        errorText={withMic ? streams.micError : null}
        rail={
          withMic && streams.micStream ? (
            <MicLevelMeter stream={streams.micStream} />
          ) : null
        }
      />

      <ToggleWithRail
        label="系统音频"
        desc="录入网页 / 应用的声音。仅在「整个屏幕」（系统选择器里需勾选「分享音频」）或「某个标签页」（自动）下生效；macOS Chrome 不支持「应用窗口」的系统音频"
        checked={withSystemAudio}
        onChange={onToggleSysAudio}
      />

      <ToggleWithRail
        label="摄像头气泡"
        desc="录制时弹出 OS 级悬浮窗显示你的脸（用户能看到，不被录进 tab/window；录「整个屏幕」时浮窗会被录进屏幕，请拖到合适位置 · 仅支持单显示器）"
        icon={<I.Camera size={18} />}
        checked={withCamera}
        onChange={onToggleCamera}
        pending={streams.cameraPending}
        errorText={withCamera ? streams.cameraError : null}
        rail={
          withCamera && streams.cameraStream ? (
            <CameraPreview stream={streams.cameraStream} sizePx={64} />
          ) : null
        }
      />

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border-default px-4 py-2 text-[13px] font-semibold text-text-secondary hover:bg-bg-tertiary"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white shadow-md"
          style={{ background: 'var(--recording-strong)' }}
        >
          <span className="h-2 w-2 rounded-full bg-white" />
          选择录制源
        </button>
      </div>
    </>
  );
}

function WaitingPanel({
  showLongHelp,
  onCancel,
}: {
  showLongHelp: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <h2 className="mb-4 text-[18px] font-bold text-text-primary">等待选择源…</h2>
      <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-tertiary p-4">
        <span className="inline-block animate-spin">
          <I.Loader size={20} />
        </span>
        <div className="flex-1 text-[13px] leading-relaxed text-text-secondary">
          请在浏览器的源选择器里选好你要录制的内容（标签页 / 应用窗口 / 整个屏幕），
          <span className="font-semibold text-text-primary">然后点选择器右下角的「分享」按钮</span>。
        </div>
      </div>

      {showLongHelp && <MacOSPermissionHelp variant="inline" />}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border-default px-4 py-2 text-[13px] font-semibold text-text-secondary hover:bg-bg-tertiary"
        >
          取消
        </button>
      </div>
    </>
  );
}

function ToggleWithRail({
  label,
  desc,
  icon,
  checked,
  onChange,
  pending,
  errorText,
  rail,
}: {
  label: string;
  desc: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  pending?: boolean;
  errorText?: string | null;
  rail?: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={`mt-3 rounded-lg border p-3 transition ${
        checked
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-bg-primary'
      }`}
    >
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={pending}
        className="flex w-full items-start gap-3 text-left disabled:cursor-wait"
      >
        <span
          className="mt-1 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-md border-2"
          style={{ borderColor: checked ? 'var(--primary-600)' : 'var(--border-strong)' }}
        >
          {checked && !pending && <I.Check size={12} sw={3} />}
          {pending && (
            <span className="inline-block animate-spin">
              <I.Loader size={10} />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-text-primary">
            {icon}
            {label}
          </div>
          <div className="mt-0.5 text-[11.5px] text-text-tertiary">{desc}</div>
        </div>
      </button>

      {(rail || errorText) && (
        <div className="mt-2 pl-[30px]">
          {rail}
          {errorText && (
            <div className="mt-1 text-[11.5px] font-semibold text-[rgb(220,38,38)]">
              ⚠️ {errorText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
