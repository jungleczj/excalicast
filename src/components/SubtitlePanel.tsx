'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { I } from '@/components/icons';
import { downloadSrt, pollSubtitleJob, submitSubtitleJob } from '@/services/subtitleClient';
import { clearSubtitleSrt, getRecording, loadRecordingMediaTracks, saveSubtitleSrt } from '@/lib/db-client';
import { trackEvent } from '@/lib/analytics/track';
import { useMediaTasks } from '@/components/providers/MediaTaskProvider';
import { announceMediaTaskCreated, openMediaTaskCenter } from '@/components/MediaTaskCenter';

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

async function waitForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Subtitle generation cancelled', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = window.setTimeout(finish, POLL_INTERVAL_MS);
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Subtitle generation cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function SubtitlePanel({ open, recordingId, onSaved, onRemoved }: Props): JSX.Element | null {
  const t = useTranslations('subtitlePanel');
  const [phase, setPhase] = useState<Phase>('idle');
  const [srt, setSrt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [mockReason, setMockReason] = useState<string | null>(null);
  const [existingSrt, setExistingSrt] = useState<string | null>(null);
  const { tasks, startTask } = useMediaTasks();
  const currentTask = tasks.find((task) => task.recordingId === recordingId && task.kind === 'asr');
  const running = currentTask?.status === 'queued' || currentTask?.status === 'running';

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setSrt('');
      setError(null);
      setMockReason(null);
      setExistingSrt(null);
      return;
    }
    let cancelled = false;
    void getRecording(recordingId).then((r) => {
      if (cancelled) return;
      const existing = r?.subtitleSrt ?? null;
      if (existing) {
        setExistingSrt(existing);
        setSrt(existing);
        setPhase('done');
      }
    });
    return () => { cancelled = true; };
  }, [open, recordingId]);

  const startJob = async () => {
    if (running) {
      openMediaTaskCenter(recordingId);
      return;
    }
    setError(null);
    setPhase('reading');
    try {
      announceMediaTaskCreated(recordingId, document.activeElement);
      const result = await startTask({
        recordingId,
        kind: 'asr',
        resourceClass: 'network',
        configSnapshot: { language: 'auto' },
      }, async (report, signal) => {
        report({ phase: 'reading', ratio: 0.02 });
        const full = await loadRecordingMediaTracks(recordingId, ['audio']);
        if (!full.audioBlob) throw new Error('no_audio_track');
        if ((full.metadata?.durationMs ?? 0) < AUDIO_MIN_DURATION_MS) throw new Error('audio_too_short');
        if (full.audioBlob.size < AUDIO_MIN_BYTES) throw new Error('no_speech_detected');
        const submitted = await submitSubtitleJob(recordingId, {
          audioBlob: full.audioBlob,
          signal,
          onUploadProgress: (uploaded, total) => report({
            phase: 'uploading',
            ratio: total > 0 ? 0.05 + Math.min(1, uploaded / total) * 0.2 : 0.05,
          }),
        });
        if (submitted.mock) setMockReason(submitted.reason ?? t('mockReason'));
        for (let attempt = 0; attempt < POLL_MAX; attempt += 1) {
          const polled = await pollSubtitleJob(submitted.jobId);
          if (polled.status === 'failed') throw new Error(polled.error ?? 'unknown');
          if (polled.status === 'done') {
            const finalSrt = polled.srt?.trim() ?? '';
            if (!finalSrt) throw new Error('subtitle_empty');
            report({ phase: 'saving', ratio: 0.96, checkpoint: { remoteJobId: submitted.jobId } });
            await saveSubtitleSrt(recordingId, finalSrt);
            void syncSubtitleToCloud(recordingId, finalSrt);
            return { resultRef: `subtitle:${recordingId}`, details: { srt: finalSrt } };
          }
          report({
            phase: polled.status,
            ratio: polled.status === 'running' ? 0.65 : 0.28,
            checkpoint: { remoteJobId: submitted.jobId },
          });
          await waitForPoll(signal);
        }
        throw new Error(t('timeout'));
      });
      const finalSrt = result.details && 'srt' in result.details && typeof result.details.srt === 'string'
        ? result.details.srt
        : '';
      if (finalSrt) {
        setSrt(finalSrt);
        setExistingSrt(finalSrt);
        setPhase('done');
        trackEvent('subtitle_generate', { recordingId });
        onSaved?.(finalSrt);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'submit_failed');
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

        {running && (
          <button type="button" onClick={() => openMediaTaskCenter(recordingId)} className="btn-sketch mt-2" style={{ justifyContent: 'center' }}>
            <I.List size={13} /> {t('running')}
          </button>
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
