'use client';

import { useEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type JSX, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ExportRatioPicker } from '@/components/ExportRatioPicker';
import { ExportFormatPanel } from '@/components/ExportFormatPanel';
import { ExportPreview } from '@/components/ExportPreview';
import { ExportPanel } from '@/components/ExportPanel';
import { VideoBackgroundPanel } from '@/components/VideoBackgroundPanel';
import { WorkspaceShellToggle } from '@/components/WorkspaceShellToggle';
import { SubtitlePanel } from '@/components/SubtitlePanel';
import { HandoutPanel } from '@/components/HandoutPanel';
import { DubbingPanel } from '@/components/DubbingPanel';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';
import { Timeline } from '@/components/editor/Timeline';
import { I, LogoMark } from '@/components/icons';
import { analyzeRecordingForAutoEdit, AutoEditError, type AutoEditMode, type AutoEditProgress, type AutoEditResult } from '@/services/autoEditAnalyzer';
import { indexedDbAutoEditCache } from '@/services/autoEditCacheStore';
import { TierBadge } from '@/components/TierBadge';
import { ShareButton } from '@/components/ShareButton';
import { MediaTaskCenter, announceMediaTaskCreated, openMediaTaskCenter } from '@/components/MediaTaskCenter';
import { useMediaTaskActions } from '@/components/providers/MediaTaskProvider';
import { useSubscription } from '@/hooks/useSubscription';
import {
  deleteRecording,
  getRecording,
  loadRecordingMediaTracks,
  saveEnhancedAudioTrack,
  setActiveEnhancedAudioTrack,
  listEnhancedAudioTracks,
  updateRecordingAutoZooms,
  updateRecordingHighlights,
  updateRecordingKeyPointMotions,
  updateRecordingSegments,
  updateRecordingTitle,
} from '@/lib/db-client';
import { getCurrentOwnerKey } from '@/lib/ownerKey';
import { projectRecordingSetupToExport } from '@/services/recordingSetupProjection';
import type {
  AutoZoomSegment,
  ExportConfig,
  HighlightEffectSegment,
  EnhancedAudioTrack,
  KeyPointMotionSegment,
  LocalizedTrack,
  NoiseReductionMode,
  RecordingMetadata,
  TimeSegment,
} from '@/types/recording';
import { normalizeSegmentSequence, isTrimmed } from '@/utils/segments';
import { parseSrt } from '@/utils/srtParser';
import { createAudioPeaksForBlob, loadOrCreateAudioPeakTrack } from '@/services/audioPeakTrack';
import { buildLocalKeyPointMotions, migrateKeyPointMotionSegment } from '@/services/keyPointMotion';
import { generateKeyPointMotions } from '@/services/keyPointMotionClient';
import { audioSourceFingerprint, createEnhancedAudioTrack } from '@/services/audioEnhancement';
import { Link, useRouter } from '@/i18n/navigation';

const DEFAULT_CONFIG: ExportConfig = {
  aspectRatio: '16:9',
  croppingMode: 'fit_all_content',
  alwaysKeepZoomedIn: false,
  fps: 15,
  withWatermark: true,
};

type Tab = 'export' | 'captions' | 'dubbing' | 'outline' | 'handout';

export default function EditorRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';
  const locale = useLocale();
  const en = locale === 'en';
  const subscription = useSubscription();
  const { startTask, cancelTask, findTask } = useMediaTaskActions();
  const isPro = subscription.tier === 'pro' || subscription.tier === 'max';
  const isMax = subscription.tier === 'max';

  const [meta, setMeta] = useState<RecordingMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG);
  const [paymentDone, setPaymentDone] = useState(false);
  const [tab, setTab] = useState<Tab>('export');
  const [title, setTitle] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState<false | 'pro' | 'max'>(false);
  const [actionGuide, setActionGuide] = useState<string | null>(null);
  // 时间轴裁剪：保留段（源 ms）+ 播放头源时间
  const [segments, setSegments] = useState<TimeSegment[]>([]);
  const [autoZooms, setAutoZooms] = useState<AutoZoomSegment[]>([]);
  const [selectedAutoZoomId, setSelectedAutoZoomId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<HighlightEffectSegment[]>([]);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [keyPointMotions, setKeyPointMotions] = useState<KeyPointMotionSegment[]>([]);
  const [selectedKeyPointMotionId, setSelectedKeyPointMotionId] = useState<string | null>(null);
  const [keyPointGenerationPhase, setKeyPointGenerationPhase] = useState<'idle' | 'generating' | 'ready' | 'failed'>('idle');
  const [keyPointGenerationSource, setKeyPointGenerationSource] = useState<'deepseek' | 'local' | null>(null);
  const [keyPointGenerationError, setKeyPointGenerationError] = useState<string | null>(null);
  const [audioEnhancementPhase, setAudioEnhancementPhase] = useState<'idle' | 'processing' | 'ready' | 'failed'>('idle');
  const [audioEnhancementMode, setAudioEnhancementMode] = useState<NoiseReductionMode | 'original'>('original');
  const [audioEnhancementProgress, setAudioEnhancementProgress] = useState(0);
  const [audioEnhancementError, setAudioEnhancementError] = useState<string | null>(null);
  const [autoEditPhase, setAutoEditPhase] = useState<'idle' | 'analyzing' | 'applied' | 'failed'>('idle');
  const [autoEditResult, setAutoEditResult] = useState<AutoEditResult | null>(null);
  const [autoEditError, setAutoEditError] = useState<string | null>(null);
  const [autoEditProgress, setAutoEditProgress] = useState<AutoEditProgress | null>(null);
  const [autoEditPreviousSegments, setAutoEditPreviousSegments] = useState<TimeSegment[] | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const captionCues = useMemo(() => parseSrt(meta?.subtitleSrt ?? ''), [meta?.subtitleSrt]);
  const showActionGuide = useCallback((message: string) => {
    setActionGuide(message);
    window.setTimeout(() => setActionGuide((current) => current === message ? null : current), 3_200);
  }, []);
  const handleSubtitleSaved = useCallback((subtitleSrt: string) => {
    setMeta((current) => current ? { ...current, subtitleSrt } : current);
    setConfig((current) => ({ ...current }));
  }, []);
  const handleSubtitleRemoved = useCallback(() => {
    setMeta((current) => current ? { ...current, subtitleSrt: undefined } : current);
    setConfig((current) => ({ ...current }));
  }, []);

  useEffect(() => {
    if (!id || !meta?.hasAudio) {
      setAudioPeaks([]);
      return;
    }
    let cancelled = false;
    const resultHolder: { peaks?: number[] } = {};
    void startTask({
      recordingId: id,
      kind: 'audio_peaks',
      resourceClass: 'local_heavy',
      configSnapshot: { samplesPerSecond: 4 },
    }, async (report) => {
      report({ phase: 'building_waveform', ratio: 0.05 });
      const track = await loadOrCreateAudioPeakTrack(id, 4);
      resultHolder.peaks = track?.peaks ?? [];
      report({ phase: 'building_waveform', ratio: 0.96 });
      return { resultRef: `audio-peaks:${id}` };
    }).then(() => {
      if (!cancelled) setAudioPeaks(resultHolder.peaks ?? []);
    }).catch(() => {
      if (!cancelled) setAudioPeaks([]);
    });
    return () => { cancelled = true; };
  }, [id, meta?.hasAudio, startTask]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.get('creem_purchase')) return;
    setPaymentDone(true);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    const tid = setTimeout(() => setPaymentDone(false), 6000);
    return () => clearTimeout(tid);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const applyRecording = (m: RecordingMetadata) => {
      setMeta(m);
      setFinalizing(false);
      setTitle(m.title?.trim() || (en ? `Recording ${id.slice(0, 8)}` : `录制 ${id.slice(0, 8)}`));
      const savedAutoZooms = m.autoZooms ?? [];
      const savedHighlights = m.highlights ?? [];
      const savedCaptionCues = parseSrt(m.subtitleSrt ?? '');
      const savedKeyPointMotions = (m.keyPointMotions ?? [])
        .map((segment) => migrateKeyPointMotionSegment(segment, savedCaptionCues));
      const localizedDefaults = m.localizedTrackId
        ? { localizedTrackId: m.localizedTrackId, muteOriginalAudio: true }
        : {};
      const audioEnhancementDefaults = m.activeEnhancedAudioTrackId
        ? { activeEnhancedAudioTrackId: m.activeEnhancedAudioTrackId }
        : {};
      setAutoZooms(savedAutoZooms);
      setSelectedAutoZoomId(savedAutoZooms[0]?.id ?? null);
      setHighlights(savedHighlights);
      setSelectedHighlightId(savedHighlights[0]?.id ?? null);
      setKeyPointMotions(savedKeyPointMotions);
      setSelectedKeyPointMotionId(savedKeyPointMotions[0]?.id ?? null);
      if (m.setup) {
        setConfig({
          ...projectRecordingSetupToExport(m.setup, DEFAULT_CONFIG),
          ...localizedDefaults,
          ...audioEnhancementDefaults,
          autoZooms: savedAutoZooms.length ? savedAutoZooms : undefined,
          highlights: savedHighlights.length ? savedHighlights : undefined,
          keyPointMotions: savedKeyPointMotions.length ? savedKeyPointMotions : undefined,
        });
      } else if (
        savedAutoZooms.length
        || savedHighlights.length
        || savedKeyPointMotions.length
        || m.localizedTrackId
        || m.activeEnhancedAudioTrackId
      ) {
        setConfig((c) => ({
          ...c,
          ...localizedDefaults,
          ...audioEnhancementDefaults,
          autoZooms: savedAutoZooms.length ? savedAutoZooms : undefined,
          highlights: savedHighlights.length ? savedHighlights : undefined,
          keyPointMotions: savedKeyPointMotions.length ? savedKeyPointMotions : undefined,
        }));
      }
      setSegments(normalizeSegmentSequence(m.segments, m.durationMs));
      setPlayheadMs(0);
    };

    const load = async () => {
      try {
        const ownerKey = await getCurrentOwnerKey();
        const m = await getRecording(id, ownerKey);
        if (cancelled) return;
        if (!m) {
          setFinalizing(false);
          setLoadError(en ? `Recording not found: ${id}` : `录制不存在：${id}`);
          return;
        }
        if (m.status === 'error') {
          setFinalizing(false);
          setLoadError(en ? 'Recording failed while saving.' : '录制保存失败。');
          return;
        }
        if (m.status !== 'done' && m.status !== 'interrupted') {
          setMeta(null);
          setFinalizing(true);
          retryTimer = setTimeout(load, 250);
          return;
        }
        applyRecording(m);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load_failed');
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, en]);

  const handlePaidChange = useCallback((isPaidNow: boolean) => {
    if (isPaidNow) setConfig((c) => ({ ...c, withWatermark: false }));
  }, []);

  const handleConfigChange = useCallback((next: ExportConfig) => {
    setConfig((prev) => {
      if (next.aspectRatio === prev.aspectRatio) return next;
      const ratioFraming = {
        ...prev.ratioFraming,
        [prev.aspectRatio]: {
          croppingMode: prev.croppingMode,
          alwaysKeepZoomedIn: prev.alwaysKeepZoomedIn,
          cropWindow: prev.cropWindow,
          customOutput: prev.customOutput,
        },
      };
      const targetFraming = ratioFraming[next.aspectRatio];
      return {
        ...next,
        croppingMode: targetFraming?.croppingMode ?? 'fit_all_content',
        alwaysKeepZoomedIn: targetFraming?.alwaysKeepZoomedIn ?? false,
        cropWindow: targetFraming?.cropWindow,
        customOutput: targetFraming?.customOutput,
        ratioFraming,
      };
    });
  }, []);

  const commitTitle = useCallback(() => {
    if (!id) return;
    void updateRecordingTitle(id, title);
  }, [id, title]);

  const clearAutoEditUndo = useCallback(() => {
    const running = findTask(id, 'auto_edit');
    if (running) cancelTask(running.id);
    setAutoEditPhase('idle');
    setAutoEditResult(null);
    setAutoEditError(null);
    setAutoEditProgress(null);
    setAutoEditPreviousSegments(null);
  }, [cancelTask, findTask, id]);

  const handleAutoEdit = useCallback(async (preset: AutoEditMode) => {
    if (!meta || !meta.hasAudio) return;
    const originalSegments = segments.map((segment) => ({ ...segment }));
    const resultHolder: { partial?: AutoEditResult; final?: AutoEditResult } = {};
    setAutoEditPhase('analyzing');
    setAutoEditResult(null);
    setAutoEditError(null);
    setAutoEditProgress({ stage: 'reading', progress: 0, etaMs: null });
    setAutoEditPreviousSegments(originalSegments);
    announceMediaTaskCreated(id, document.activeElement);
    try {
      await startTask({
        recordingId: id,
        kind: 'auto_edit',
        resourceClass: 'local_heavy',
        configSnapshot: { preset, originalSegments },
      }, async (report, signal) => {
        const result = await analyzeRecordingForAutoEdit({
          recordingId: id,
          durationMs: meta.durationMs,
          currentSegments: originalSegments,
          subtitleSrt: meta.subtitleSrt,
          preset,
          mediaSignature: `${meta.startedAt}:${meta.durationMs}:${Number(meta.hasAudio)}:${Number(meta.hasCamera)}`,
          cache: indexedDbAutoEditCache,
          signal,
          onProgress: (stage, progress, etaMs) => {
            report({ phase: stage, ratio: progress, etaMs });
            setAutoEditProgress({ stage, progress, etaMs });
          },
          onStageResult: (_stage, stageResult) => {
            resultHolder.partial = stageResult;
            setSegments(stageResult.segments);
            setAutoEditResult(stageResult);
          },
        });
        resultHolder.final = result;
        await updateRecordingSegments(id, result.segments);
        return { resultRef: `auto-edit:${id}:${Date.now()}` };
      });
      const result = resultHolder.final ?? resultHolder.partial;
      if (result) {
        setSegments(result.segments);
        setAutoEditResult(result);
      }
      setAutoEditProgress({ stage: 'complete', progress: 1, etaMs: 0 });
      setAutoEditPhase('applied');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (resultHolder.partial) {
          setAutoEditResult(resultHolder.partial);
          setAutoEditPhase('applied');
        } else {
          setAutoEditPreviousSegments(null);
          setAutoEditPhase('idle');
        }
        setAutoEditProgress(null);
        return;
      }
      const code = error instanceof AutoEditError ? error.code : 'audio_decode_failed';
      setAutoEditError(en
        ? ({ no_audio: 'This recording has no audio to analyze.', audio_decode_failed: 'Could not read this local audio track.', browser_unsupported: 'This browser cannot analyze local audio.' }[code])
        : ({ no_audio: '这条录制没有可分析的音频。', audio_decode_failed: '无法读取这条录制的本地音轨。', browser_unsupported: '当前浏览器无法分析本地音频。' }[code]));
      setAutoEditPhase('failed');
      setAutoEditProgress(null);
    }
  }, [en, id, meta, segments, startTask]);

  const handleCancelAutoEdit = useCallback(() => {
    const running = findTask(id, 'auto_edit');
    if (running && ['queued', 'running'].includes(running.status)) cancelTask(running.id);
  }, [cancelTask, findTask, id]);

  const handleUndoAutoEdit = useCallback(() => {
    if (autoEditPreviousSegments) setSegments(autoEditPreviousSegments);
    clearAutoEditUndo();
  }, [autoEditPreviousSegments, clearAutoEditUndo]);

  const handleTimelineSegmentsChange = useCallback((next: TimeSegment[]) => {
    clearAutoEditUndo();
    setSegments(next.length ? next : segments);
  }, [clearAutoEditUndo, segments]);

  // 保留段 → 同步进 config.segments（导出用）+ 去抖持久化到 recording.segments
  useEffect(() => {
    if (!meta) return;
    const trimmed = isTrimmed(segments, meta.durationMs);
    const segs = trimmed ? segments : undefined;
    setConfig((c) => (JSON.stringify(c.segments) === JSON.stringify(segs) ? c : { ...c, segments: segs }));
    const tid = setTimeout(() => { void updateRecordingSegments(id, trimmed ? segments : []); }, 500);
    return () => clearTimeout(tid);
  }, [segments, meta, id]);

  // Autozoom 段 → 同步进 config.autoZooms（预览/导出用）+ 去抖持久化。
  useEffect(() => {
    if (!meta) return;
    const next = autoZooms.length > 0 ? autoZooms : undefined;
    setConfig((c) => (JSON.stringify(c.autoZooms) === JSON.stringify(next) ? c : { ...c, autoZooms: next }));
    const tid = setTimeout(() => { void updateRecordingAutoZooms(id, autoZooms); }, 500);
    return () => clearTimeout(tid);
  }, [autoZooms, meta, id]);

  useEffect(() => {
    if (!meta) return;
    const next = highlights.length > 0 ? highlights : undefined;
    setConfig((current) => (JSON.stringify(current.highlights) === JSON.stringify(next) ? current : { ...current, highlights: next }));
    const timer = setTimeout(() => { void updateRecordingHighlights(id, highlights); }, 500);
    return () => clearTimeout(timer);
  }, [highlights, id, meta]);

  useEffect(() => {
    if (!meta) return;
    const next = keyPointMotions.length > 0 ? keyPointMotions : undefined;
    setConfig((current) => (JSON.stringify(current.keyPointMotions) === JSON.stringify(next) ? current : { ...current, keyPointMotions: next }));
    const timer = setTimeout(() => { void updateRecordingKeyPointMotions(id, keyPointMotions); }, 500);
    return () => clearTimeout(timer);
  }, [id, keyPointMotions, meta]);

  // 预览框选直接更新时间轴同一段的中心点/倍率；随后现有去抖持久化会把这组
  // 参数写入 recording，因此最终导出与预览使用完全相同的目标区域。
  const handleAutoZoomRegionChange = useCallback((zoomId: string, patch: Partial<Pick<AutoZoomSegment, 'scale' | 'cx' | 'cy'>>) => {
    setAutoZooms((current) => current.map((zoom) => zoom.id === zoomId ? { ...zoom, ...patch } : zoom));
  }, []);

  const handleHighlightRegionChange = useCallback((highlightId: string, region: HighlightEffectSegment['region']) => {
    setHighlights((current) => current.map((item) => item.id === highlightId ? { ...item, region } : item));
  }, []);

  const handleGenerateKeyPointMotions = useCallback(async () => {
    if (!meta?.subtitleSrt || captionCues.length === 0) return;
    if (keyPointMotions.length > 0 && !window.confirm(en
      ? 'Replace the existing key point motion track with this new version?'
      : '是否用新版本替换现有的内容要点动效轨道？')) return;
    setKeyPointGenerationPhase('generating');
    setKeyPointGenerationSource(null);
    setKeyPointGenerationError(null);
    announceMediaTaskCreated(id, document.activeElement);
    try {
      let generated: KeyPointMotionSegment[] = [];
      let generationSource: 'deepseek' | 'local' = 'deepseek';
      await startTask({
        recordingId: id,
        kind: 'key_point_motion',
        resourceClass: 'network',
        configSnapshot: { locale: locale === 'en' ? 'en' : 'zh', cueCount: captionCues.length },
      }, async (report, signal) => {
        report({ phase: 'preparing', ratio: 0.05 });
        try {
          const result = await generateKeyPointMotions({
            cues: captionCues,
            durationMs: meta.durationMs,
            locale: locale === 'en' ? 'en' : 'zh',
            signal,
          });
          generated = result.motions;
        } catch (error) {
          if (signal.aborted) throw error;
          generated = buildLocalKeyPointMotions(captionCues, meta.durationMs, locale === 'en' ? 'en' : 'zh');
          generationSource = 'local';
          setKeyPointGenerationError(error instanceof Error ? error.message : 'key_point_generation_failed');
        }
        if (generated.length === 0) throw new Error('no_key_points');
        report({ phase: generationSource === 'local' ? 'local_fallback' : 'saving', ratio: 0.9 });
        await updateRecordingKeyPointMotions(id, generated);
        return { resultRef: `key-points:${id}:${generationSource}` };
      });
      setKeyPointMotions(generated);
      setSelectedKeyPointMotionId(generated[0]?.id ?? null);
      setKeyPointGenerationSource(generationSource);
      setKeyPointGenerationPhase('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setKeyPointGenerationError(error instanceof Error ? error.message : 'key_point_generation_failed');
      setKeyPointGenerationPhase('failed');
    }
  }, [captionCues, en, id, keyPointMotions.length, locale, meta, startTask]);

  const activateEnhancedTrack = useCallback(async (track: EnhancedAudioTrack) => {
    await setActiveEnhancedAudioTrack(id, track.id);
    setMeta((current) => current ? { ...current, activeEnhancedAudioTrackId: track.id } : current);
    setConfig((current) => ({ ...current, activeEnhancedAudioTrackId: track.id }));
    setAudioEnhancementMode(track.mode);
    setAudioEnhancementPhase('ready');
    setAudioEnhancementProgress(1);
    setAudioPeaks(await createAudioPeaksForBlob(track.audioBlob, track.durationMs, 4));
  }, [id]);

  const handleRunAudioEnhancement = useCallback(async (mode: NoiseReductionMode) => {
    if (!meta?.hasAudio) return;
    setAudioEnhancementMode(mode);
    setAudioEnhancementPhase('processing');
    setAudioEnhancementProgress(0);
    setAudioEnhancementError(null);
    const resultHolder: { pending?: EnhancedAudioTrack; completed?: EnhancedAudioTrack } = {};
    announceMediaTaskCreated(id, document.activeElement);
    try {
      await startTask({
        recordingId: id,
        kind: 'noise_reduction',
        resourceClass: 'local_heavy',
        configSnapshot: { mode },
      }, async (report, signal) => {
        report({ phase: 'reading_audio', ratio: 0.01 });
        const recording = await loadRecordingMediaTracks(id, ['audio']);
        if (!recording.audioBlob) throw new Error('audio_source_missing');
        const sourceFingerprint = audioSourceFingerprint(recording.audioBlob, meta.durationMs);
        const cached = (await listEnhancedAudioTracks(id)).find((track) => (
          track.mode === mode
          && track.status === 'ready'
          && track.sourceFingerprint === sourceFingerprint
          && track.audioBlob.size > 0
        ));
        if (cached) {
          resultHolder.completed = cached;
          await setActiveEnhancedAudioTrack(id, cached.id);
          return { resultRef: cached.id };
        }
        resultHolder.pending = {
          id: `noise-${mode}-${Date.now().toString(36)}`,
          recordingId: id,
          sourceFingerprint,
          mode,
          modelVersion: mode === 'enhanced' ? 'rnnoise-2025.1.5' : 'speech-filter-v1',
          status: 'processing',
          durationMs: meta.durationMs,
          audioBlob: new Blob([], { type: 'audio/wav' }),
          createdAt: Date.now(),
        };
        await saveEnhancedAudioTrack(resultHolder.pending, false);
        const generated = await createEnhancedAudioTrack({
          recordingId: id,
          audioBlob: recording.audioBlob,
          durationMs: meta.durationMs,
          mode,
          signal,
          onProgress: (phase, progress) => {
            setAudioEnhancementProgress(progress);
            report({ phase, ratio: progress });
          },
        });
        const readyTrack: EnhancedAudioTrack = { ...generated, id: resultHolder.pending.id, status: 'ready' };
        await saveEnhancedAudioTrack(readyTrack, true);
        await setActiveEnhancedAudioTrack(id, readyTrack.id);
        resultHolder.completed = readyTrack;
        return { resultRef: readyTrack.id };
      });
      if (resultHolder.completed) await activateEnhancedTrack(resultHolder.completed);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAudioEnhancementPhase('idle');
        return;
      }
      const message = error instanceof Error ? error.message : 'audio_enhancement_failed';
      setAudioEnhancementError(message);
      setAudioEnhancementPhase('failed');
      if (resultHolder.pending) {
        await saveEnhancedAudioTrack({ ...resultHolder.pending, status: 'failed', error: message }, false).catch(() => undefined);
      }
    }
  }, [activateEnhancedTrack, id, meta, startTask]);

  const handleUseOriginalAudio = useCallback(() => {
    const running = findTask(id, 'noise_reduction');
    if (running && ['queued', 'running'].includes(running.status)) cancelTask(running.id);
    setAudioEnhancementMode('original');
    setAudioEnhancementPhase('idle');
    setAudioEnhancementProgress(0);
    setAudioEnhancementError(null);
    setMeta((current) => current ? { ...current, activeEnhancedAudioTrackId: undefined } : current);
    setConfig((current) => ({ ...current, activeEnhancedAudioTrackId: undefined }));
    void setActiveEnhancedAudioTrack(id, undefined);
    if (meta?.hasAudio) void loadOrCreateAudioPeakTrack(id, 4).then((track) => setAudioPeaks(track?.peaks ?? []));
  }, [cancelTask, findTask, id, meta?.hasAudio]);

  const handleLocalizedTrackReady = useCallback((track: LocalizedTrack) => {
    setMeta((current) => current ? { ...current, localizedTrackId: track.id } : current);
    setConfig((current) => ({ ...current, localizedTrackId: track.id, muteOriginalAudio: true }));
  }, []);

  const handleLocalizedTrackSelect = useCallback((track: LocalizedTrack | null) => {
    setMeta((current) => current ? { ...current, localizedTrackId: track?.id } : current);
    setConfig((current) => {
      if (track) return { ...current, localizedTrackId: track.id, muteOriginalAudio: true };
      const { localizedTrackId: _localizedTrackId, muteOriginalAudio: _muteOriginalAudio, ...rest } = current;
      return rest;
    });
  }, []);

  useEffect(() => {
    const subtitleSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ recordingId: string; srt: string }>).detail;
      if (detail.recordingId === id) handleSubtitleSaved(detail.srt);
    };
    const dubbingReady = (event: Event) => {
      const detail = (event as CustomEvent<{ recordingId: string; track: LocalizedTrack }>).detail;
      if (detail.recordingId === id) handleLocalizedTrackReady(detail.track);
    };
    window.addEventListener('excalicast:subtitle-saved', subtitleSaved);
    window.addEventListener('excalicast:dubbing-ready', dubbingReady);
    return () => {
      window.removeEventListener('excalicast:subtitle-saved', subtitleSaved);
      window.removeEventListener('excalicast:dubbing-ready', dubbingReady);
    };
  }, [handleLocalizedTrackReady, handleSubtitleSaved, id]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!confirm(en ? 'Delete this recording? Cannot be undone.' : '删除这条录制？此操作不可恢复。')) return;
    await deleteRecording(id, await getCurrentOwnerKey());
    router.push('/library');
  }, [id, router, en]);

  if (loadError) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center">
          <div className="px-8 py-6 text-center" style={CARD}>
            <p style={{ fontSize: 13, color: 'var(--rec)', fontFamily: 'var(--font-mono)' }}>{loadError}</p>
            <Link href="/library" className="mt-4 inline-block" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', borderBottom: '1.5px solid var(--ink)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {en ? 'Back to library' : '返回录制库'}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!meta) {
    return (
      <Shell>
        <div className="grid flex-1 place-items-center" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {finalizing ? (en ? 'Finishing recording…' : '正在完成录制…') : (en ? 'Loading recording…' : '加载录制…')}
        </div>
      </Shell>
    );
  }


  const exportTab = (
    <div className="space-y-5">
      <WorkspaceShellToggle recordingId={id} config={config} onChange={handleConfigChange} />
      <VideoBackgroundPanel config={config} onChange={handleConfigChange} />
      <ExportRatioPicker config={config} onChange={handleConfigChange} />
      <ExportFormatPanel config={config} onChange={setConfig} en={en} />
      <div style={{ height: 1.5, background: 'var(--ink)', opacity: 0.4 }} />
      <ExportPanel
        recordingId={id}
        config={config}
        fallbackCroppingMode="fit_all_content"
        onConfigChange={setConfig}
        onPaidStateChange={handlePaidChange}
      />
    </div>
  );

  const lockBlock = (target: 'pro' | 'max', title2: string, desc: string) => (
    <div style={{ ...CARD, padding: 22 }} className="text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center" style={{ background: target === 'max' ? 'var(--max)' : 'var(--pro)', border: '1.6px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)' }}>
        <I.Lock size={20} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{title2}</div>
      <p className="mt-2" style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{desc}</p>
      <button type="button" className="btn-sketch btn-sketch-primary mt-4" onClick={() => setUpgradeOpen(target)}>
        <I.Sparkles size={13} /> {en ? `Upgrade to ${target.toUpperCase()}` : `升级 ${target.toUpperCase()}`}
      </button>
    </div>
  );

  const tabContent = (() => {
    if (tab === 'captions') return isPro ? (
      <SubtitlePanel
        open
        recordingId={id}
        onSaved={handleSubtitleSaved}
        onRemoved={handleSubtitleRemoved}
      />
    ) : lockBlock('pro', en ? 'Captions are a Pro feature' : '字幕是 Pro 功能', en ? 'Generate accurate subtitles from your audio.' : '从音频生成精准字幕。');
    if (tab === 'dubbing') return isMax ? (
      <DubbingPanel
        recordingId={id}
        metadata={meta}
        activeTrackId={config.localizedTrackId ?? meta.localizedTrackId}
        en={en}
        onTrackReady={handleLocalizedTrackReady}
        onTrackSelect={handleLocalizedTrackSelect}
      />
    ) : lockBlock('max', en ? 'Dubbing is a Max feature' : '翻译配音是 Max 功能', en ? 'Generate English voice, English subtitles, and optional lip-sync for the camera bubble.' : '生成英文语音、英文字幕，并可为人像气泡做口型同步。');
    if (tab === 'outline') return isMax ? <HandoutPanel view="outline" recordingId={id} config={config} onJumpToTime={setPlayheadMs} /> : lockBlock('max', en ? 'Outline is a Max feature' : '大纲是 Max 功能', en ? 'Auto chapters with jump-to-time.' : '自动识别章节、点击跳转预览。');
    if (tab === 'handout') return isMax ? <HandoutPanel view="handout" recordingId={id} config={config} /> : lockBlock('max', en ? 'Handout is a Max feature' : '讲义是 Max 功能', en ? 'Markdown handout — download / copy.' : '生成 Markdown 讲义，可下载 / 复制。');
    return exportTab;
  })();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'export', label: en ? 'Export' : '导出' },
    { id: 'captions', label: en ? 'Captions' : '字幕' },
    { id: 'dubbing', label: en ? 'Dubbing' : '配音' },
    { id: 'outline', label: en ? 'Outline' : '大纲' },
    { id: 'handout', label: en ? 'Handout' : '讲义' },
  ];

  return (
    <Shell>
      {/* Editor top bar */}
      <div className="editor-craft-topbar flex h-14 flex-shrink-0 items-center gap-3 px-4 sm:px-6" style={{ borderBottom: '1.8px solid var(--ink)', background: 'var(--paper)' }}>
        <Link href="/library" className="editor-craft-back grid h-8 w-8 place-items-center" style={{ border: '1.4px solid var(--ink)', background: 'var(--paper)', borderRadius: 3, color: 'var(--ink)' }} aria-label={en ? 'Back' : '返回'}>
          <I.ChevronLeft size={14} />
        </Link>
        <LogoMark size={26} />
        <div className="hidden h-5 sm:block" style={{ width: 1.5, background: 'var(--ink)', opacity: 0.4 }} />
        <div className="min-w-0 flex-1">
          <div className="label-mono" style={{ fontSize: 8.5 }}>// {en ? 'PROJECT' : '项目'}</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            maxLength={80}
            className="w-full max-w-[420px] truncate bg-transparent outline-none"
            style={{ border: 'none', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}
          />
        </div>
        <ShareButton recordingId={id} isMax={isMax} onUpgrade={() => setUpgradeOpen('max')} />
        <TierBadge tier={subscription.tier} />
        <MediaTaskCenter recordingId={id} en={en} />
      </div>

      {actionGuide && (
        <div className="editor-action-guide" role="status" data-testid="editor-action-guide">
          {actionGuide}
          <button type="button" aria-label={en ? 'Dismiss' : '关闭'} onClick={() => setActionGuide(null)}><I.Close size={13} /></button>
        </div>
      )}

      {paymentDone && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4 py-2" style={{ background: 'var(--ok, #1a7f37)', color: '#fff', border: '1.4px solid var(--ink)', borderRadius: 4, boxShadow: '3px 3px 0 var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {en ? 'Payment received · unlocked' : '支付完成 · 已解锁'}
        </div>
      )}

      <div className="editor-craft-body flex flex-1 overflow-hidden">
        {/* Left: player + timeline */}
        <div className="editor-craft-main flex flex-1 flex-col overflow-auto p-6" style={{ borderRight: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          {/* 预览 + 时间轴 + 删除 共用全宽列：填满左列、两者等宽对齐 */}
          <div className="w-full">
          <div className="flex w-full justify-center">
            <div className="editor-craft-card editor-craft-preview-shell flex w-full justify-center" style={{ ...CARD, padding: 0 }}>
              <ExportPreview
                recordingId={id}
                metadata={meta}
                config={config}
                segments={segments}
                playheadMs={playheadMs}
                onPlayheadChange={setPlayheadMs}
                selectedAutoZoomId={selectedAutoZoomId}
                onAutoZoomRegionChange={handleAutoZoomRegionChange}
                selectedHighlightId={selectedHighlightId}
                onHighlightRegionChange={handleHighlightRegionChange}
              />
            </div>
          </div>

          {/* Timeline — 主流剪辑交互：播放头 scrub + Split + 选段删除 + 边缘 Trim */}
          <div className="mt-5" data-testid="editor-timeline">
            <Timeline
              durationMs={meta.durationMs}
              clips={segments}
              playheadMs={playheadMs}
              onScrub={setPlayheadMs}
              onChange={handleTimelineSegmentsChange}
              onReset={() => {
                clearAutoEditUndo();
                setSegments(normalizeSegmentSequence(undefined, meta.durationMs));
              }}
              hasAudio={meta.hasAudio}
              hasCaptions={!!meta.subtitleSrt}
              audioPeaks={audioPeaks}
              captionCues={captionCues}
              autoZooms={autoZooms}
              onAutoZoomChange={setAutoZooms}
              selectedAutoZoomId={selectedAutoZoomId}
              onAutoZoomSelect={setSelectedAutoZoomId}
              highlights={highlights}
              onHighlightChange={setHighlights}
              selectedHighlightId={selectedHighlightId}
              onHighlightSelect={setSelectedHighlightId}
              keyPointMotions={keyPointMotions}
              onKeyPointMotionChange={setKeyPointMotions}
              selectedKeyPointMotionId={selectedKeyPointMotionId}
              onKeyPointMotionSelect={setSelectedKeyPointMotionId}
              onGenerateKeyPointMotions={handleGenerateKeyPointMotions}
              keyPointGenerationPhase={keyPointGenerationPhase}
              keyPointGenerationSource={keyPointGenerationSource}
              keyPointGenerationError={keyPointGenerationError}
              onRequireCaptions={() => setTab('captions')}
              onGuide={showActionGuide}
              onLocateTask={() => openMediaTaskCenter(id)}
              audioEnhancement={{
                phase: audioEnhancementPhase,
                mode: audioEnhancementMode,
                progress: audioEnhancementProgress,
                error: audioEnhancementError,
                onRun: (mode) => { void handleRunAudioEnhancement(mode); },
                onOriginal: handleUseOriginalAudio,
                onCancel: handleUseOriginalAudio,
              }}
              autoEdit={{
                phase: autoEditPhase,
                result: autoEditResult,
                error: autoEditError,
                progress: autoEditProgress,
                onRun: handleAutoEdit,
                onUndo: handleUndoAutoEdit,
                onCancel: handleCancelAutoEdit,
                labels: {
                  autoEdit: en ? 'Apply ChatCut' : '套用 ChatCut',
                  chatCut: en ? 'ChatCut scenes' : 'ChatCut 场景',
                  lecture: en ? 'Lecture · keep pauses' : '讲解 · 保留停顿',
                  walkthrough: en ? 'Walkthrough · balanced' : '演示 · 均衡节奏',
                  shorts: en ? 'Short-form · concise' : '短内容 · 紧凑成片',
                  timing: en ? 'Timing only' : '仅按节奏',
                  gentle: en ? 'Gentle' : '轻柔',
                  standard: en ? 'Standard' : '标准',
                  tight: en ? 'Tight' : '紧凑',
                  analyzing: en ? 'Analyzing…' : '分析中…',
                  noAudio: en ? 'Record audio to use auto edit' : '录制音频后可使用自动剪辑',
                  removed: (cuts, seconds) => en
                    ? `${cuts} quiet gap${cuts === 1 ? '' : 's'} removed · ${seconds}s`
                    : `已移除 ${cuts} 段静音 · ${seconds} 秒`,
                  noCuts: en ? 'No long silence found' : '未发现可安全移除的长静音',
                  sceneAware: (transitions: number, alignedCuts: number) => en
                    ? `PySceneDetect · ${transitions} transition${transitions === 1 ? '' : 's'} found · ${alignedCuts} edge${alignedCuts === 1 ? '' : 's'} aligned`
                    : `PySceneDetect · 发现 ${transitions} 个转场 · 对齐 ${alignedCuts} 个剪辑边界`,
                  undo: en ? 'Undo' : '撤销',
                },
              }}
              labels={{
                basic: en ? 'Basic' : '基础功能',
                advanced: en ? 'Advanced' : '高级功能',
                reset: en ? 'Reset' : '复原',
                kept: en ? 'Kept' : '保留',
                mic: en ? 'Mic' : '麦克风',
                captions: en ? 'Captions' : '字幕',
                split: en ? 'Split' : '切一刀',
                deleteClip: en ? 'Delete' : '删片段',
                hint: en
                  ? 'Drag playhead/edges to scrub · Split (S) then Delete to cut any part'
                  : '拖播放头/边缘实时预览 · 切一刀(S)后删片段即可剪掉任意段',
                autoZoom: 'Autozoom',
                autoZoomHint: en
                  ? 'Drag onto the purple zoom lane, or click to add at the playhead'
                  : '拖入紫色放大轨道，或点击在播放头处添加',
                editAutoZoomScale: en ? 'Edit zoom scale' : '编辑放大倍率',
                highlight: en ? 'Highlight' : '高亮',
                noiseReduction: en ? 'Remove background noise' : '去除背景杂音',
                standardNoiseReduction: en ? 'Standard · fast local cleanup' : '标准 · 快速本地降噪',
                enhancedNoiseReduction: en ? 'Enhanced · local AI' : '增强 · 本地 AI',
                originalAudio: en ? 'Original audio' : '原声',
                keyPointMotion: en ? 'Generate key point motion' : '生成内容要点动效',
                keyPointNeedsCaptions: en ? 'Generate captions first' : '请先生成字幕',
                generating: en ? 'Generating…' : '生成中…',
                keyPointAi: en ? 'AI generated' : 'AI 已生成',
                keyPointLocal: en ? 'Local fallback' : '本地回退',
                keyPointFailed: en ? 'Generation failed' : '生成失败',
                spotlight: en ? 'Spotlight' : '聚光',
                focusFrame: en ? 'Focus frame' : '焦点框',
                cursorHalo: en ? 'Center halo' : '中心光晕',
                textCallout: en ? 'Text callout' : '文字标注',
                calloutText: en ? 'Callout text' : '标注文案',
                opacity: en ? 'Shade' : '遮罩',
                selectClipFirst: en ? 'Select a clip before deleting it.' : '请先选择需要删除的片段。',
                nothingToReset: en ? 'There are no timeline edits to restore.' : '当前没有需要复原的时间轴修改。',
                noiseReductionNeedsAudio: en ? 'Record microphone audio before removing background noise.' : '请先录制麦克风音频，再使用背景降噪。',
                zoomMinimum: en ? 'The timeline already fits the window.' : '时间轴已经适合当前窗口。',
                zoomMaximum: en ? 'The timeline is already at maximum zoom.' : '时间轴已经放大到最大比例。',
              }}
            />
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={handleDelete} className="editor-craft-delete btn-sketch" style={{ padding: '7px 12px', fontSize: 10, color: 'var(--rec)', borderColor: 'var(--rec)' }}>
              <I.Trash size={12} /> {en ? 'Delete recording' : '删除录制'}
            </button>
          </div>
          </div>
        </div>

        {/* Right: tabbed panel */}
        <aside className="editor-craft-side flex-shrink-0 overflow-y-auto p-6" style={{ width: 420, background: 'var(--paper)' }}>
          <div className="editor-craft-tabs mb-5 flex gap-1" style={{ borderBottom: '1.5px solid var(--ink)' }}>
            {tabs.map((tb) => {
              const active = tab === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  data-active={active}
                  onClick={() => setTab(tb.id)}
                  className="press"
                  style={{
                    padding: '8px 12px', marginBottom: -1.5,
                    background: active ? 'var(--hi)' : 'transparent',
                    border: active ? '1.4px solid var(--ink)' : '1.4px solid transparent',
                    borderBottom: active ? 'none' : '1.4px solid transparent',
                    borderRadius: '3px 3px 0 0',
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: 'var(--ink)', cursor: 'pointer',
                  }}
                >
                  {tb.label}
                </button>
              );
            })}
          </div>
          {/* 切 Tab 内容淡入（key 变化重新触发入场） */}
          <div key={tab} className="fade-in">{tabContent}</div>
        </aside>
      </div>

      <ProUpgradeModal
        open={!!upgradeOpen}
        tier={upgradeOpen === 'max' ? 'max' : 'pro'}
        onClose={() => setUpgradeOpen(false)}
        onUpgraded={() => { setUpgradeOpen(false); void subscription.refresh(); }}
      />
    </Shell>
  );
}

const CARD: CSSProperties = {
  background: '#fffdf8', border: '1px solid rgba(24,25,26,0.08)', borderRadius: 28, boxShadow: '0 14px 36px rgba(48,38,26,0.09), inset 0 1px 0 rgba(255,255,255,0.74)',
};

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="app-craft-screen editor-craft-shell flex h-full flex-col" style={{ background: 'var(--paper-2)' }}>{children}</div>;
}
