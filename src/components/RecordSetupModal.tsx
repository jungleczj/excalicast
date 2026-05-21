'use client';

import { useState } from 'react';
import { I } from '@/components/icons';

export interface RecordSetupValues {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (values: RecordSetupValues) => void;
}

export function RecordSetupModal({ open, onCancel, onConfirm }: Props): JSX.Element | null {
  const [withMic, setWithMic] = useState(true);
  const [withSystemAudio, setWithSystemAudio] = useState(false);
  const [withCamera, setWithCamera] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-2xl bg-bg-primary p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[18px] font-bold text-text-primary">开始录制</h2>

        <Toggle label="麦克风" desc="录入你说的话" checked={withMic} onChange={setWithMic} />
        <Toggle
          label="系统音频"
          desc="录入网页 / 应用的声音。仅在「整个屏幕」（系统选择器里需勾选「分享音频」）或「某个标签页」（自动）下生效；macOS Chrome 不支持「应用窗口」的系统音频"
          checked={withSystemAudio}
          onChange={setWithSystemAudio}
        />
        <Toggle
          label="摄像头气泡"
          desc="录制时弹出 OS 级悬浮窗显示你的脸（用户能看到，不被录进 tab/window；录「整个屏幕」时浮窗会被录进屏幕，请拖到合适位置 · 仅支持单显示器）"
          checked={withCamera}
          onChange={setWithCamera}
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
            onClick={() => onConfirm({ withMic, withSystemAudio, withCamera })}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'var(--recording-strong)' }}
          >
            <span className="h-2 w-2 rounded-full bg-white" />
            选择录制源
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`mt-3 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
        checked
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
      }`}
    >
      <span
        className="mt-1 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-md border-2"
        style={{ borderColor: checked ? 'var(--primary-600)' : 'var(--border-strong)' }}
      >
        {checked && <I.Check size={12} sw={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-text-primary">{label}</div>
        <div className="mt-0.5 text-[11.5px] text-text-tertiary">{desc}</div>
      </div>
    </button>
  );
}
