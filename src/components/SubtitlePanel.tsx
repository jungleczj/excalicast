'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { downloadSrt, pollSubtitleJob, submitSubtitleJob } from '@/services/subtitleClient';
import { clearSubtitleSrt, getRecording, loadFullRecording, saveSubtitleSrt } from '@/lib/db-client';

/**
 * 客户端预检阈值：低于此值的音频几乎肯定无法被 ASR 识别。
 *  - Opus 32 kbps（4 KB/s）静音文件常 <4 KB；正常语音每秒 ~4 KB。
 *  - 2000 字节大约 0.5 s 真正语音的量级，做相对宽松的兜底。
 */
const AUDIO_MIN_BYTES = 2000;
const AUDIO_MIN_DURATION_MS = 500;

/**
 * 把后端 / 本地预检产生的错误码翻译成给用户看的文案。
 * 命中 i18n 键的归 i18n；其它（包括上游 DashScope 任意中文）做剥前缀处理后透传。
 */
function describeError(
  err: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!err) return t('errors.unknown');
  if (err === 'no_speech_detected') return t('errors.noSpeechDetected');
  if (err === 'no_audio_track') return t('errors.noAudio');
  if (err === 'audio_too_short') return t('errors.tooShort');
  // 兜底：剥掉历史/上游已经带过的 "字幕生成失败：" 前缀，避免与 failedTitle 双重前缀
  return err.replace(/^字幕生成失败[：:]\s*/, '').trim() || err;
}

interface Props {
  open: boolean;
  recordingId: string;
  onClose: () => void;
  onSaved?: (srt: string) => void;
}

type Phase = 'idle' | 'uploading' | 'pending' | 'running' | 'done' | 'failed';

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 240;

export function SubtitlePanel({ open, recordingId, onClose, onSaved }: Props): JSX.Element | null {
  const t = useTranslations('subtitlePanel');
  const [phase, setPhase] = useState<Phase>('idle');
  const [srt, setSrt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [mockReason, setMockReason] = useState<string | null>(null);
  const [existingSrt, setExistingSrt] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setSrt('');
      setError(null);
      setJobId(null);
      setMockReason(null);
      setExistingSrt(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    // 打开时检查是否已有字幕
    void getRecording(recordingId).then((r) => {
      const existing = r?.subtitleSrt ?? null;
      if (existing) {
        setExistingSrt(existing);
        setSrt(existing);
        setPhase('done');
      }
    });
  }, [open, recordingId]);

  const startJob = async () => {
    setError(null);
    setPhase('uploading');
    // 客户端预检：避免给 DashScope 扔肯定识别不了的样本
    try {
      const full = await loadFullRecording(recordingId);
      if (!full.audioBlob) {
        setPhase('failed');
        setError('no_audio_track');
        return;
      }
      if ((full.metadata?.durationMs ?? 0) < AUDIO_MIN_DURATION_MS) {
        setPhase('failed');
        setError('audio_too_short');
        return;
      }
      if (full.audioBlob.size < AUDIO_MIN_BYTES) {
        setPhase('failed');
        setError('no_speech_detected');
        return;
      }
    } catch {
      // 预检本身出错就不阻塞，继续走线上识别
    }

    try {
      const r = await submitSubtitleJob(recordingId);
      setJobId(r.jobId);
      if (r.mock) {
        setMockReason(r.reason ?? t('mockReason'));
      }
      setPhase('pending');
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
      setError(t('timeout'));
      return;
    }
    try {
      const r = await pollSubtitleJob(id);
      if (r.status === 'done') {
        const finalSrt = r.srt ?? '';
        setSrt(finalSrt);
        setPhase('done');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (finalSrt) {
          await saveSubtitleSrt(recordingId, finalSrt);
          setExistingSrt(finalSrt);
          onSaved?.(finalSrt);
        }
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

  const handleRemove = async () => {
    await clearSubtitleSrt(recordingId);
    setExistingSrt(null);
    setSrt('');
    setPhase('idle');
  };

  if (!open) return null;

  const hasPersistedSrt = phase === 'done' && existingSrt && existingSrt === srt;

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
          aria-label={t('closeAria')}
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
            <h2 className="text-[20px] font-bold leading-tight text-text-primary">{t('title')}</h2>
            <p className="text-[12px] text-text-secondary">{t('subtitle')}</p>
          </div>
        </div>

        {phase === 'idle' && !existingSrt && (
          <button
            type="button"
            onClick={() => void startJob()}
            className="mt-2 flex items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            <I.Sparkles size={14} /> {t('start')}
          </button>
        )}

        {(phase === 'uploading' || phase === 'pending' || phase === 'running') && (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-border-default bg-bg-secondary p-3">
            <span
              className="inline-block h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700"
              aria-hidden
            />
            <span className="text-[12px] text-text-primary">
              {phase === 'uploading' && t('uploading')}
              {phase === 'pending' && t('pending')}
              {phase === 'running' && t('running')}
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
            {hasPersistedSrt && (
              <div className="mt-2 rounded-md border border-success-300 bg-success-50 px-3 py-2 text-[12px] text-success-700">
                {t('savedHint')}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-text-primary">{t('preview')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void startJob()}
                  className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-primary px-3 py-1.5 text-[11px] font-semibold text-text-secondary hover:bg-bg-tertiary"
                >
                  <I.Sparkles size={11} /> {t('regenerate')}
                </button>
                <button
                  type="button"
                  onClick={() => downloadSrt(srt, `excalicast_${recordingId.slice(0, 8)}.srt`)}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                  style={{ background: 'var(--primary-600)' }}
                >
                  <I.Download size={12} /> {t('download')}
                </button>
              </div>
            </div>
            <pre className="mt-2 flex-1 overflow-auto rounded-md border border-border-default bg-bg-secondary p-3 text-[11px] leading-relaxed text-text-primary font-mono whitespace-pre-wrap">
              {srt}
            </pre>
            {hasPersistedSrt && (
              <button
                type="button"
                onClick={() => void handleRemove()}
                className="mt-3 self-start text-[11px] text-text-tertiary underline-offset-2 hover:text-recording-strong hover:underline"
              >
                {t('removeFromRecording')}
              </button>
            )}
          </>
        )}

        {phase === 'failed' && (
          <div className="mt-2 rounded-md border border-recording-strong bg-red-50 p-3 text-[12px] text-recording-strong">
            <div className="font-semibold mb-1">{t('failedTitle')}</div>
            <div>{describeError(error, t as (key: string) => string)}</div>
            <button
              onClick={() => void startJob()}
              className="mt-3 rounded-md border border-current px-3 py-1 text-[11px] font-semibold"
            >
              {t('retry')}
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-[10px] text-text-tertiary">{t('footer')}</p>
      </div>
    </div>
  );
}
