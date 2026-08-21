'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { I } from '@/components/icons';
import { listLocalizedTracks, loadRecordingMediaTracks, setActiveLocalizedTrack } from '@/lib/db-client';
import { isUsableLocalizedTrack } from '@/lib/localizedTrack';
import { createEnglishDubbingTrack, resumeEnglishDubbingTrack } from '@/services/dubbingClient';
import type { LocalizedTrack, RecordingMetadata } from '@/types/recording';
import { useMediaTasks } from '@/components/providers/MediaTaskProvider';
import { announceMediaTaskCreated, openMediaTaskCenter } from '@/components/MediaTaskCenter';
import {
  analyzeVoiceProfileFromBlob,
  resolveAzureVoiceChoice,
  type DubbingVoiceChoice,
  type VoiceProfile,
} from '@/services/voiceProfile';

interface Props {
  recordingId: string;
  metadata: RecordingMetadata;
  activeTrackId?: string;
  en: boolean;
  onTrackReady: (track: LocalizedTrack) => void;
  onTrackSelect: (track: LocalizedTrack | null) => void;
}

const CARD_STYLE: CSSProperties = {
  background: '#fffdf8',
  border: '1px solid rgba(24,25,26,0.08)',
  borderRadius: 24,
  boxShadow: '0 14px 36px rgba(48,38,26,0.08), inset 0 1px 0 rgba(255,255,255,0.76)',
};

function labelForTrack(track: LocalizedTrack, en: boolean): string {
  const date = new Date(track.createdAt);
  const time = date.toLocaleTimeString(en ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
  return en ? `English version · ${time}` : `英文版本 · ${time}`;
}

export function DubbingPanel({
  recordingId,
  metadata,
  activeTrackId,
  en,
  onTrackReady,
  onTrackSelect,
}: Props): JSX.Element {
  const [tracks, setTracks] = useState<LocalizedTrack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [legacyTrackCount, setLegacyTrackCount] = useState(0);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [voiceChoice, setVoiceChoice] = useState<DubbingVoiceChoice>('auto');
  const [analyzingVoice, setAnalyzingVoice] = useState(false);
  const [fallbackCheckpoint, setFallbackCheckpoint] = useState<{ remoteJobId: string; sourceAudioHash: string } | null>(null);
  const voiceAnalysisRef = useRef<Promise<VoiceProfile> | null>(null);
  const { tasks, startTask } = useMediaTasks();
  const currentTask = tasks.find((task) => task.recordingId === recordingId && task.kind === 'dubbing');
  const busy = currentTask?.status === 'queued' || currentTask?.status === 'running';

  const activeTrack = useMemo(
    () => tracks.find((track) => track.id === activeTrackId) ?? null,
    [activeTrackId, tracks],
  );

  const refreshTracks = useCallback(async () => {
    const rows = await listLocalizedTracks(recordingId);
    const usable = rows.filter(isUsableLocalizedTrack);
    setTracks(usable);
    setLegacyTrackCount(rows.length - usable.length);
  }, [recordingId]);

  useEffect(() => {
    let cancelled = false;
    listLocalizedTracks(recordingId)
      .then(async (rows) => {
        if (cancelled) return;
        const usable = rows.filter(isUsableLocalizedTrack);
        setTracks(usable);
        setLegacyTrackCount(rows.length - usable.length);
        if (activeTrackId && !usable.some((track) => track.id === activeTrackId)) {
          await setActiveLocalizedTrack(recordingId, undefined);
          onTrackSelect(null);
        }
      })
      .catch(() => { if (!cancelled) setTracks([]); });
    return () => { cancelled = true; };
  }, [activeTrackId, onTrackSelect, recordingId]);

  useEffect(() => {
    if (!metadata.hasAudio) return;
    const controller = new AbortController();
    setAnalyzingVoice(true);
    const analysis = loadRecordingMediaTracks(recordingId, ['audio'])
      .then(({ audioBlob }) => {
        if (!audioBlob) throw new Error('voice_profile_audio_missing');
        return analyzeVoiceProfileFromBlob(audioBlob, { signal: controller.signal });
      });
    voiceAnalysisRef.current = analysis;
    analysis
      .then((profile) => setVoiceProfile(profile))
      .catch((analysisError) => {
        if (!(analysisError instanceof DOMException && analysisError.name === 'AbortError')) {
          setVoiceProfile(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnalyzingVoice(false);
        if (voiceAnalysisRef.current === analysis) voiceAnalysisRef.current = null;
      });
    return () => controller.abort();
  }, [metadata.hasAudio, recordingId]);

  const effectiveVoiceProfile = useMemo<VoiceProfile>(() => voiceProfile ?? {
    register: 'uncertain',
    confidence: 0,
    medianPitchHz: null,
    pitchRangeHz: 0,
    voicedFrameRatio: 0,
    analyzedDurationMs: 0,
    analyzerVersion: 'voice-profile-v1',
  }, [voiceProfile]);
  const generate = useCallback(async () => {
    if (busy) {
      openMediaTaskCenter(recordingId);
      return;
    }
    if (!metadata.hasAudio) {
      setError(en ? 'Record microphone audio first.' : '请先录制麦克风音频。');
      return;
    }
    if (!metadata.subtitleSrt?.trim()) {
      setError(en ? 'Generate subtitles first.' : '请先生成字幕。');
      return;
    }
    setError(null);
    const taskVoiceProfile = voiceChoice === 'auto' && voiceAnalysisRef.current
      ? await voiceAnalysisRef.current.catch(() => effectiveVoiceProfile)
      : effectiveVoiceProfile;
    const taskVoiceName = resolveAzureVoiceChoice(taskVoiceProfile, voiceChoice);
    const resultHolder: { track?: LocalizedTrack } = {};
    announceMediaTaskCreated(recordingId, document.activeElement);
    try {
      await startTask({
        recordingId,
        kind: 'dubbing',
        resourceClass: 'network',
        configSnapshot: { targetLang: 'en', subtitleRevision: metadata.subtitleSrt.length, voiceName: taskVoiceName },
      }, async (report, signal) => {
        const track = await createEnglishDubbingTrack({
          recordingId,
          sourceSrt: metadata.subtitleSrt,
          voiceName: taskVoiceName,
          voiceProfile: taskVoiceProfile,
          signal,
          persistTask: false,
          onCheckpoint: (checkpoint) => {
            setFallbackCheckpoint(checkpoint);
            report({ phase: 'translating', ratio: 0.08, checkpoint });
          },
          onProgress: (progress) => report({
            phase: progress.stage,
            ratio: progress.progress,
            checkpoint: currentTask?.checkpoint,
          }),
        });
        resultHolder.track = track;
        return { resultRef: track.id };
      });
      await refreshTracks();
      if (resultHolder.track) onTrackReady(resultHolder.track);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'dubbing_failed');
      }
    }
  }, [busy, currentTask?.checkpoint, effectiveVoiceProfile, en, metadata.hasAudio, metadata.subtitleSrt, onTrackReady, recordingId, refreshTracks, startTask, voiceChoice]);

  const useLocalFallback = useCallback(async () => {
    const remoteJobId = fallbackCheckpoint?.remoteJobId ?? currentTask?.checkpoint?.remoteJobId;
    const sourceAudioHash = fallbackCheckpoint?.sourceAudioHash ?? currentTask?.checkpoint?.sourceAudioHash;
    if (typeof remoteJobId !== 'string' || typeof sourceAudioHash !== 'string') {
      setError(en ? 'The resumable dubbing checkpoint is missing.' : '缺少可恢复的配音任务信息，请重新生成。');
      return;
    }
    setError(null);
    const resultHolder: { track?: LocalizedTrack } = {};
    await startTask({
      recordingId,
      kind: 'dubbing',
      resourceClass: 'local_heavy',
      configSnapshot: { targetLang: 'en', provider: 'kokoro-local', remoteJobId },
    }, async (report, signal) => {
      const track = await resumeEnglishDubbingTrack({
        recordingId,
        jobId: remoteJobId,
        sourceAudioHash,
        allowLocalFallback: true,
        signal,
        persistTask: false,
        onProgress: (progress) => report({
          phase: progress.stage,
          ratio: progress.progress,
          checkpoint: { remoteJobId, sourceAudioHash },
        }),
      });
      resultHolder.track = track;
      return { resultRef: track.id };
    });
    await refreshTracks();
    if (resultHolder.track) onTrackReady(resultHolder.track);
  }, [currentTask?.checkpoint, en, fallbackCheckpoint, onTrackReady, recordingId, refreshTracks, startTask]);

  const selectTrack = useCallback(async (track: LocalizedTrack | null) => {
    await setActiveLocalizedTrack(recordingId, track?.id);
    onTrackSelect(track);
  }, [onTrackSelect, recordingId]);

  return (
    <div className="space-y-4">
      <section className="p-5" style={CARD_STYLE}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="label-mono mb-2" style={{ fontSize: 11 }}>
              {en ? 'Dubbing' : '翻译配音'}
            </h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.6 }}>
              {en
                ? 'Turn the original Chinese voice into an English preview and export track. The original audio stays in your local recording and is muted only for this version.'
                : '把中文原声生成英文预览与导出轨。原始音频仍保留在本地录制里，只在这个版本中静音。'}
            </p>
          </div>
          <span
            className="label-mono"
            style={{
              border: '1px solid rgba(24,25,26,.10)',
              borderRadius: 999,
              padding: '4px 8px',
              background: 'var(--max)',
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}
          >
            MAX
          </span>
        </div>

        <div className="mt-5" style={{ borderTop: '1px solid rgba(24,25,26,.08)', paddingTop: 14 }}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span style={{ color: 'var(--ink-2)', fontSize: 12, fontWeight: 680 }}>
              {en ? 'English voice' : '英文声音'}
            </span>
            <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
              {analyzingVoice
                ? (en ? 'Analyzing original voice…' : '正在分析原声…')
                : voiceProfile?.register === 'masculine'
                  ? (en ? 'Lower voice detected' : '检测到偏低沉声线')
                  : voiceProfile?.register === 'feminine'
                    ? (en ? 'Higher voice detected' : '检测到偏明亮声线')
                    : (en ? 'Using neutral fallback' : '使用自然默认声线')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={en ? 'English voice selection' : '英文声音选择'}>
            {([
              ['auto', en ? 'Auto' : '自动'],
              ['masculine', en ? 'Male' : '男声'],
              ['feminine', en ? 'Female' : '女声'],
            ] as const).map(([value, label]) => {
              const selected = voiceChoice === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setVoiceChoice(value)}
                  style={{
                    minHeight: 34,
                    border: `1px solid ${selected ? 'var(--ink)' : 'rgba(24,25,26,.12)'}`,
                    borderRadius: 9,
                    background: selected ? 'var(--ink)' : 'var(--paper)',
                    color: selected ? 'var(--paper)' : 'var(--ink-2)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 680,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <button
            type="button"
            onClick={generate}
            className="mt-4 flex w-full items-center justify-center gap-2 transition"
            style={{
              minHeight: 48,
              border: '1.4px solid var(--ink)',
              borderRadius: 999,
              background: 'var(--ink)',
              color: 'var(--paper)',
              boxShadow: '0 14px 28px rgba(24,25,26,.14), inset 0 1px 0 rgba(255,255,255,.12)',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 720,
              cursor: 'pointer',
              opacity: 1,
            }}
          >
            <I.Sparkles size={15} />
            {en ? 'Generate English version' : '生成英文版本'}
          </button>

        {legacyTrackCount > 0 && (
          <p className="mt-3" style={{ color: 'var(--ink-3)', fontSize: 11.5, lineHeight: 1.5 }}>
            {en
              ? 'An older placeholder version was disabled. Generate it again to get real English speech.'
              : '旧的占位配音版本已停用，请重新生成真实英文语音。'}
          </p>
        )}

        {error && (
          <div className="mt-3">
            <p style={{ color: 'var(--rec)', fontSize: 12, lineHeight: 1.5 }}>
              {error === 'dubbing_local_fallback_required'
                ? (en ? 'Free Edge speech is temporarily unavailable.' : '免费 Edge 配音暂时不可用。')
                : (en ? `Dubbing failed: ${error}` : `配音生成失败：${error}`)}
            </p>
            {error === 'dubbing_local_fallback_required' && (
              <button
                type="button"
                onClick={() => void useLocalFallback().catch((fallbackError) => {
                  setError(fallbackError instanceof Error ? fallbackError.message : 'local_dubbing_failed');
                })}
                style={{
                  marginTop: 8, minHeight: 34, border: '1px solid rgba(24,25,26,.14)', borderRadius: 9,
                  background: 'var(--paper)', color: 'var(--ink)', padding: '0 12px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 680,
                }}
              >
                {en ? 'Use local model instead' : '改用本地模型'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="p-4" style={CARD_STYLE}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="label-mono" style={{ fontSize: 10 }}>
            {en ? 'Versions' : '版本'}
          </h4>
          {activeTrack && (
            <span
              data-testid="dubbing-active-track"
              style={{ color: 'var(--ok)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
            >
              {en ? 'English active' : '英文已启用'}
            </span>
          )}
        </div>

        {tracks.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            {en ? 'No English version yet.' : '还没有英文版本。'}
          </p>
        ) : (
          <div className="space-y-2">
            {tracks.map((track) => {
              const active = track.id === activeTrackId;
              return (
                <button
                  key={track.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectTrack(track)}
                  className="flex w-full items-center justify-between gap-3 text-left transition"
                  style={{
                    padding: '12px 13px',
                    border: '1px solid rgba(24,25,26,.10)',
                    borderRadius: 18,
                    background: active ? 'var(--hi-soft)' : 'var(--paper)',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 680 }}>{labelForTrack(track, en)}</span>
                    <span style={{ display: 'block', marginTop: 2, color: 'var(--ink-3)', fontSize: 11 }}>
                      {track.lipSync === 'done'
                        ? (en ? 'Dubbed audio · lip-sync camera' : '英文配音 · 口型人像')
                        : (en ? 'Dubbed audio · original camera' : '英文配音 · 原始人像')}
                    </span>
                  </span>
                  {active ? <I.Check size={15} /> : <I.ChevronRight size={14} />}
                </button>
              );
            })}
            {activeTrack && (
              <button
                type="button"
                onClick={() => selectTrack(null)}
                className="mt-2"
                style={{ border: 'none', background: 'transparent', color: 'var(--ink-3)', fontSize: 12, cursor: 'pointer' }}
              >
                {en ? 'Use original audio instead' : '改用原始音频'}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
