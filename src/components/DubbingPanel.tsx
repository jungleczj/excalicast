'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { I } from '@/components/icons';
import { getLatestMediaTask, listLocalizedTracks, saveLocalizedTrack, setActiveLocalizedTrack } from '@/lib/db-client';
import { createEnglishDubbingTrack, resumeEnglishDubbingTrack } from '@/services/dubbingClient';
import type { LocalizedTrack, RecordingMetadata } from '@/types/recording';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTrack = useMemo(
    () => tracks.find((track) => track.id === activeTrackId) ?? null,
    [activeTrackId, tracks],
  );

  const refreshTracks = useCallback(async () => {
    const rows = await listLocalizedTracks(recordingId);
    setTracks(rows);
  }, [recordingId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listLocalizedTracks(recordingId), getLatestMediaTask(recordingId, 'dubbing')])
      .then(async ([rows, task]) => {
        if (cancelled) return;
        setTracks(rows);
        const jobId = typeof task?.checkpoint?.remoteJobId === 'string' ? task.checkpoint.remoteJobId : null;
        const sourceAudioHash = typeof task?.checkpoint?.sourceAudioHash === 'string' ? task.checkpoint.sourceAudioHash : null;
        if (!jobId || !sourceAudioHash || !['queued', 'running', 'paused'].includes(task?.status ?? '')) return;
        setBusy(true);
        try {
          const track = await resumeEnglishDubbingTrack({ recordingId, jobId, sourceAudioHash });
          if (cancelled) return;
          await saveLocalizedTrack(track, true);
          await refreshTracks();
          onTrackReady(track);
        } catch (resumeError) {
          if (!cancelled) setError(resumeError instanceof Error ? resumeError.message : 'dubbing_failed');
        } finally {
          if (!cancelled) setBusy(false);
        }
      })
      .catch(() => { if (!cancelled) setTracks([]); });
    return () => { cancelled = true; };
  }, [onTrackReady, recordingId, refreshTracks]);

  const generate = useCallback(async () => {
    if (!metadata.hasAudio) return;
    setBusy(true);
    setError(null);
    try {
      const track = await createEnglishDubbingTrack({
        recordingId,
        sourceSrt: metadata.subtitleSrt,
      });
      await saveLocalizedTrack(track, true);
      await refreshTracks();
      onTrackReady(track);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'dubbing_failed');
    } finally {
      setBusy(false);
    }
  }, [metadata.hasAudio, metadata.subtitleSrt, onTrackReady, recordingId, refreshTracks]);

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

        {!metadata.hasAudio ? (
          <div
            className="mt-4 rounded-[18px] px-4 py-3"
            style={{ background: 'var(--paper-2)', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}
          >
            {en ? 'Record microphone audio to create an English dubbed version.' : '录制麦克风音频后，才可以生成英文配音版本。'}
          </div>
        ) : (
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 transition"
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
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.58 : 1,
            }}
          >
            {busy ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full" style={{ border: '2px solid rgba(255,255,255,.24)', borderTopColor: 'var(--paper)' }} />
                {en ? 'Generating English version…' : '正在生成英文版本…'}
              </>
            ) : (
              <>
                <I.Sparkles size={15} />
                {en ? 'Generate English version' : '生成英文版本'}
              </>
            )}
          </button>
        )}

        {error && (
          <p className="mt-3" style={{ color: 'var(--rec)', fontSize: 12, lineHeight: 1.5 }}>
            {en ? `Dubbing failed: ${error}` : `配音生成失败：${error}`}
          </p>
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
