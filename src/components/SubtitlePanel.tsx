'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';
import { downloadSrt, pollSubtitleJob, submitSubtitleJob } from '@/services/subtitleClient';

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
}

type Phase = 'idle' | 'uploading' | 'pending' | 'running' | 'done' | 'failed';

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 240; // 10 分钟

export function SubtitlePanel({ open, recordingId, onClose }: Props): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle');
  const [srt, setSrt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [mockReason, setMockReason] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setSrt('');
      setError(null);
      setJobId(null);
      setMockReason(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  const startJob = async () => {
    setError(null);
    setPhase('uploading');
    try {
      const r = await submitSubtitleJob(recordingId);
      setJobId(r.jobId);
      if (r.mock) {
        setMockReason(r.reason ?? '使用 mock SRT');
      }
      setPhase('pending');
      // immediately kick off first poll cycle
      void pollOnce(r.jobId);
      pollRef.current = setInterval(() => void pollOnce(r.jobId), POLL_INTERVAL_MS);
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'submit_failed');
    }
  };

  const pollCount = useRef(0);
  const pollOnce = async (id: string) => {
    pollCount.current += 1;
    if (pollCount.current > POLL_MAX) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setPhase('failed');
      setError('字幕生成超时（10 分钟），请重试');
      return;
    }
    try {
      const r = await pollSubtitleJob(id);
      if (r.status === 'done') {
        setSrt(r.srt ?? '');
        setPhase('done');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (r.status === 'failed') {
        setPhase('failed');
        setError(r.error ?? 'unknown');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      } else {
        setPhase(r.status);
      }
    } catch {
      // transient — keep polling
    }
  };

  if (!open) return null;

  return (
    <div
      className="fade-in fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-[640px] max-w-[92vw] max-h-[80vh] rounded-2xl bg-bg-primary p-7 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
          aria-label="关闭"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div
            className="grid h-12 w-12 place-items-center rounded-2xl text-white"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            <I.Subtitles size={22} />
          </div>
          <div>
            <h2 className="text-[20px] font-bold leading-tight text-text-primary">语音字幕</h2>
            <p className="text-[12px] text-text-secondary">
              自动识别中英文，输出 SRT 时间轴文件
            </p>
          </div>
        </div>

        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => void startJob()}
            className="mt-2 flex items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            <I.Sparkles size={14} /> 开始生成字幕
          </button>
        )}

        {(phase === 'uploading' || phase === 'pending' || phase === 'running') && (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-border-default bg-bg-secondary p-3">
            <span
              className="inline-block h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700"
              aria-hidden
            />
            <span className="text-[12px] text-text-primary">
              {phase === 'uploading' && '正在上传音频…'}
              {phase === 'pending' && '已提交转写任务，等待开始…'}
              {phase === 'running' && '正在转写中（按音频时长 30-60 秒）…'}
            </span>
          </div>
        )}

        {phase === 'done' && (
          <>
            {mockReason && (
              <div className="mt-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[11px] text-yellow-900">
                ⚠️ {mockReason}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-text-primary">SRT 预览</span>
              <button
                type="button"
                onClick={() => downloadSrt(srt, `excalicast_${recordingId.slice(0, 8)}.srt`)}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                style={{ background: 'var(--primary-600)' }}
              >
                <I.Download size={12} /> 下载 SRT
              </button>
            </div>
            <pre className="mt-2 flex-1 overflow-auto rounded-md border border-border-default bg-bg-secondary p-3 text-[11px] leading-relaxed text-text-primary font-mono whitespace-pre-wrap">
              {srt}
            </pre>
          </>
        )}

        {phase === 'failed' && (
          <div className="mt-2 rounded-md border border-recording-strong bg-red-50 p-3 text-[12px] text-recording-strong">
            <div className="font-semibold mb-1">字幕生成失败</div>
            <div>{error}</div>
            <button
              onClick={() => void startJob()}
              className="mt-3 rounded-md border border-current px-3 py-1 text-[11px] font-semibold"
            >
              重试
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-[10px] text-text-tertiary">
          录制音频仅在生成字幕时临时上传到本应用服务器，作业完成后自动删除
        </p>
      </div>
    </div>
  );
}
