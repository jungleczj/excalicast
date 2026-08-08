'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { downloadSrt, pollSubtitleJob, submitSubtitleJob } from '@/services/subtitleClient';
import { clearSubtitleSrt, getLatestMediaTask, getRecording, loadRecordingMediaTracks, saveMediaTask, saveSubtitleSrt } from '@/lib/db-client';
import { trackEvent } from '@/lib/analytics/track';

/**
 * 客户端预检阈值：低于此值的音频几乎肯定无法被 ASR 识别。
 *  - Opus 32 kbps（4 KB/s）静音文件常 <4 KB；正常语音每秒 ~4 KB。
 *  - 2000 字节大约 0.5 s 真正语音的量级，做相对宽松的兜底。
 */
const AUDIO_MIN_BYTES = 2000;
const AUDIO_MIN_DURATION_MS = 500;

/**
 * 若录制已云端备份，则把字幕同步到云端行（recordings_cloud.subtitle_srt），
 * 否则分享/讲义读不到（先上传后生成字幕的情况）。best-effort：401/404/失败均忽略。
 */
async function syncSubtitleToCloud(recordingId: string, subtitleSrt: string | null): Promise<void> {
  try {
    await fetch(`/api/recordings/${encodeURIComponent(recordingId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subtitleSrt }),
    });
  } catch {
    /* 未登录 / 未上云 / 网络问题 → 忽略 */
  }
}

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
  /** 旧调用方兼容（现已内联进「字幕」Tab，无关闭按钮）。 */
  onClose?: () => void;
  onSaved?: (srt: string) => void;
  onRemoved?: () => void;
}

type Phase = 'idle' | 'reading' | 'uploading' | 'pending' | 'running' | 'done' | 'failed';

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 240;

export function SubtitlePanel({ open, recordingId, onSaved, onRemoved }: Props): JSX.Element | null {
  const t = useTranslations('subtitlePanel');
  const [phase, setPhase] = useState<Phase>('idle');
  const [srt, setSrt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [mockReason, setMockReason] = useState<string | null>(null);
  const [existingSrt, setExistingSrt] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

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
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      return;
    }
    // 打开时检查是否已有字幕
    let cancelled = false;
    void Promise.all([getRecording(recordingId), getLatestMediaTask(recordingId, 'asr')]).then(([r, task]) => {
      if (cancelled) return;
      const existing = r?.subtitleSrt ?? null;
      if (existing) {
        setExistingSrt(existing);
        setSrt(existing);
        setPhase('done');
        return;
      }
      const remoteJobId = typeof task?.checkpoint?.remoteJobId === 'string'
        ? task.checkpoint.remoteJobId
        : null;
      if (remoteJobId && (task?.status === 'queued' || task?.status === 'running' || task?.status === 'paused')) {
        pollCount.current = 0;
        setJobId(remoteJobId);
        setPhase('pending');
        void pollOnce(remoteJobId);
        pollRef.current = setInterval(() => void pollOnce(remoteJobId), POLL_INTERVAL_MS);
      }
    });
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [open, recordingId]);

  const startJob = async () => {
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    pollCount.current = 0;
    setError(null);
    setPhase('reading');
    setUploadProgress(0);
    // 客户端预检：避免给 DashScope 扔肯定识别不了的样本
    let preparedAudio: Blob | undefined;
    try {
      const full = await loadRecordingMediaTracks(recordingId, ['audio']);
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
      preparedAudio = full.audioBlob;
    } catch {
      // 预检本身出错就不阻塞，继续走线上识别
    }

    try {
      setPhase('uploading');
      const r = await submitSubtitleJob(recordingId, {
        audioBlob: preparedAudio,
        signal: controller.signal,
        onUploadProgress: (uploaded, total) => {
          setUploadProgress(total > 0 ? Math.min(1, uploaded / total) : 0);
        },
      });
      setJobId(r.jobId);
      const now = Date.now();
      await saveMediaTask({
        id: `asr:${r.jobId}`,
        recordingId,
        kind: 'asr',
        status: 'running',
        progress: 0,
        checkpoint: { remoteJobId: r.jobId },
        createdAt: now,
        updatedAt: now,
      });
      if (r.mock) {
        setMockReason(r.reason ?? t('mockReason'));
      }
      setPhase('pending');
      void pollOnce(r.jobId);
      pollRef.current = setInterval(() => void pollOnce(r.jobId), POLL_INTERVAL_MS);
    } catch (err) {
      if (controller.signal.aborted) return;
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
        const existingTask = await getLatestMediaTask(recordingId, 'asr');
        const finalSrt = r.srt ?? '';
        setSrt(finalSrt);
        setPhase('done');
        if (finalSrt) trackEvent('subtitle_generate', { recordingId });
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        if (finalSrt) {
          await saveSubtitleSrt(recordingId, finalSrt);
          setExistingSrt(finalSrt);
          onSaved?.(finalSrt);
          // 若该录制已上云：把字幕同步到云端行，否则分享/讲义读不到（先上传后生成字幕的情况）。
          // best-effort：未登录/未上云返回 401/404，忽略即可。
          void syncSubtitleToCloud(recordingId, finalSrt);
        }
        await saveMediaTask({
          id: `asr:${id}`,
          recordingId,
          kind: 'asr',
          status: 'completed',
          progress: 1,
          checkpoint: { remoteJobId: id },
          createdAt: existingTask?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
      } else if (r.status === 'failed') {
        const existingTask = await getLatestMediaTask(recordingId, 'asr');
        setPhase('failed');
        setError(r.error ?? 'unknown');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        await saveMediaTask({
          id: `asr:${id}`,
          recordingId,
          kind: 'asr',
          status: 'failed',
          progress: 0,
          checkpoint: { remoteJobId: id },
          error: r.error ?? 'unknown',
          createdAt: existingTask?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        setPhase(r.status);
        const existingTask = await getLatestMediaTask(recordingId, 'asr');
        await saveMediaTask({
          id: `asr:${id}`,
          recordingId,
          kind: 'asr',
          status: 'running',
          progress: r.status === 'running' ? 0.65 : 0.25,
          checkpoint: { remoteJobId: id },
          createdAt: existingTask?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
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
    onRemoved?.();
    void syncSubtitleToCloud(recordingId, null); // 一并清掉云端字幕
  };

  if (!open) return null;

  const hasPersistedSrt = phase === 'done' && existingSrt && existingSrt === srt;

  return (
    <div
      className="subtitle-craft-panel fade-in relative flex w-full flex-col p-6"
      style={{ background: 'var(--paper)', border: '1.6px solid var(--ink)', borderRadius: 4, boxShadow: 'var(--hard)' }}
    >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="subtitle-craft-icon grid h-12 w-12 place-items-center"
            style={{ background: 'var(--hi)', border: '1.6px solid var(--ink)', borderRadius: 4, color: 'var(--ink)' }}
          >
            <I.Subtitles size={22} />
          </div>
          <div>
            <h2 className="leading-tight" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{t('title')}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-2)' }}>{t('subtitle')}</p>
          </div>
        </div>

        {phase === 'idle' && !existingSrt && (
          <button
            type="button"
            onClick={() => void startJob()}
            className="btn-sketch btn-sketch-primary mt-2"
            style={{ justifyContent: 'center', padding: '12px 16px' }}
          >
            <I.Sparkles size={14} /> {t('start')}
          </button>
        )}

        {(phase === 'reading' || phase === 'uploading' || phase === 'pending' || phase === 'running') && (
          <div
            className="subtitle-craft-status fade-in mt-2 flex items-center gap-3 p-3"
            style={{ border: '1.4px solid var(--ink)', background: 'var(--paper-2)', borderRadius: 3 }}
          >
            <span
              className="inline-block h-4 w-4 flex-shrink-0 animate-spin rounded-full"
              style={{ border: '2px solid var(--rule-soft)', borderTopColor: 'var(--ink)' }}
              aria-hidden
            />
            <span style={{ fontSize: 12, color: 'var(--ink)' }}>
              {phase === 'reading' && t('reading')}
              {phase === 'uploading' && `${t('uploading')} ${Math.round(uploadProgress * 100)}%`}
              {phase === 'pending' && t('pending')}
              {phase === 'running' && t('running')}
            </span>
          </div>
        )}

        {phase === 'done' && (
          <>
            {mockReason && (
              <div className="subtitle-craft-notice mt-2 px-3 py-2" style={{ background: 'var(--hi-soft)', border: '1.4px solid var(--ink)', borderRadius: 3, fontSize: 11, color: 'var(--ink)' }}>
                ⚠️ {mockReason}
              </div>
            )}
            {hasPersistedSrt && (
              <div className="subtitle-craft-notice is-success mt-2 px-3 py-2" style={{ background: 'var(--pro)', border: '1.4px solid var(--ink)', borderRadius: 3, fontSize: 12, color: 'var(--ink)' }}>
                {t('savedHint')}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('preview')}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void startJob()} className="btn-sketch" style={{ padding: '6px 10px', fontSize: 10.5 }}>
                  <I.Sparkles size={11} /> {t('regenerate')}
                </button>
                <button
                  type="button"
                  onClick={() => downloadSrt(srt, `excalicast_${recordingId.slice(0, 8)}.srt`)}
                  className="btn-sketch btn-sketch-primary"
                  style={{ padding: '6px 10px', fontSize: 11 }}
                >
                  <I.Download size={12} /> {t('download')}
                </button>
              </div>
            </div>
            <pre
              className="subtitle-craft-preview mt-2 flex-1 overflow-auto p-3 font-mono whitespace-pre-wrap"
              style={{ border: '1.4px solid var(--ink)', background: 'var(--paper-2)', borderRadius: 3, fontSize: 11, lineHeight: 1.6, color: 'var(--ink)' }}
            >
              {srt}
            </pre>
            {hasPersistedSrt && (
              <button
                type="button"
                onClick={() => void handleRemove()}
                className="mt-3 self-start underline-offset-2 hover:underline"
                style={{ fontSize: 11, color: 'var(--ink-3)' }}
              >
                {t('removeFromRecording')}
              </button>
            )}
          </>
        )}

        {phase === 'failed' && (
          <div className="subtitle-craft-error mt-2 p-3" style={{ background: 'var(--rec-soft)', border: '1.4px solid var(--rec)', borderRadius: 3, fontSize: 12, color: 'var(--rec)' }}>
            <div className="font-semibold mb-1">{t('failedTitle')}</div>
            <div>{describeError(error, t as (key: string) => string)}</div>
            <button onClick={() => void startJob()} className="btn-sketch mt-3" style={{ padding: '5px 10px', fontSize: 11 }}>
              {t('retry')}
            </button>
          </div>
        )}

        <p className="mt-4 text-center" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{t('footer')}</p>
    </div>
  );
}
