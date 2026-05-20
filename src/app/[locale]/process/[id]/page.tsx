'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { I } from '@/components/icons';
import { getScreenRecording, loadScreenRecordingWebm } from '@/lib/db-client';
import { useSubscription } from '@/hooks/useSubscription';
import { downloadMp4Blob, exportScreenRecording, type ScreenExportFormat } from '@/services/screenExport';
import {
  pollScreenSubtitleJob,
  saveScreenSubtitle,
  submitScreenSubtitleJob,
  clearScreenSubtitle,
  downloadSrt,
} from '@/services/screenSubtitle';
import type { ScreenRecordingMetadata } from '@/types/recording';
import { Link } from '@/i18n/navigation';

type SubtitlePhase = 'idle' | 'extracting' | 'pending' | 'running' | 'done' | 'failed';

const POLL_INTERVAL_MS = 2500;
const POLL_MAX = 240;

export default function ProcessRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const subscription = useSubscription();
  const proUnlocked = subscription.permissions.exportWithoutWatermark;
  const subtitlePerm = subscription.permissions.subtitle;

  const [meta, setMeta] = useState<ScreenRecordingMetadata | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Download state
  const [busy, setBusy] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(true); // default ON when SRT exists
  const [format, setFormat] = useState<ScreenExportFormat>('mp4');
  const [progress, setProgress] = useState<{ phase: string; ratio: number } | null>(null);

  // Subtitle generation state
  const [subPhase, setSubPhase] = useState<SubtitlePhase>('idle');
  const [subError, setSubError] = useState<string | null>(null);
  const [subMockReason, setSubMockReason] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const reload = async () => {
    const m = await getScreenRecording(id);
    if (m) setMeta(m);
  };

  useEffect(() => {
    if (!id) return;
    let created: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const m = await getScreenRecording(id);
        if (!m) {
          if (!cancelled) setLoadError(`找不到录制：${id}`);
          return;
        }
        if (cancelled) return;
        setMeta(m);
        // Initial burn-in toggle: ON if SRT already exists, OFF if not
        setBurnSubtitles(!!m.subtitleSrt);
        const blob = await loadScreenRecordingWebm(id);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setVideoUrl(created);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDownload = async () => {
    setBusy(true);
    setProgress({ phase: 'loading', ratio: 0 });
    try {
      const blob = await exportScreenRecording({
        recordingId: id,
        format,
        withWatermark: !proUnlocked,
        burnSubtitles: burnSubtitles && !!meta?.subtitleSrt,
        onPhase: (p) => setProgress((s) => ({ phase: p, ratio: s?.ratio ?? 0 })),
        onProgress: (r) => setProgress((s) => ({ phase: s?.phase ?? 'transcoding', ratio: r })),
      });
      const wmTag = proUnlocked ? 'clean' : 'wm';
      const subTag = burnSubtitles && meta?.subtitleSrt ? '_sub' : '';
      downloadMp4Blob(blob, `excalicast_${id.slice(0, 8)}_${wmTag}${subTag}.${format}`);
    } catch (err) {
      alert(`下载失败：${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const startSubtitleJob = async () => {
    setSubError(null);
    setSubMockReason(null);
    setSubPhase('extracting');
    try {
      const r = await submitScreenSubtitleJob(id);
      if (r.mock && r.reason) setSubMockReason(r.reason);
      setSubPhase('pending');
      pollCount.current = 0;
      const tick = async () => {
        pollCount.current += 1;
        if (pollCount.current > POLL_MAX) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setSubPhase('failed');
          setSubError('字幕生成超时（10 分钟），请重试');
          return;
        }
        try {
          const res = await pollScreenSubtitleJob(r.jobId);
          if (res.status === 'done' && res.srt) {
            await saveScreenSubtitle(id, res.srt);
            await reload();
            setBurnSubtitles(true);
            setSubPhase('done');
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          } else if (res.status === 'failed') {
            setSubPhase('failed');
            setSubError(res.error ?? 'unknown');
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          } else {
            setSubPhase(res.status);
          }
        } catch {
          // transient — keep polling
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), POLL_INTERVAL_MS);
    } catch (err) {
      setSubPhase('failed');
      setSubError(err instanceof Error ? err.message : 'submit_failed');
    }
  };

  const handleRemoveSubtitle = async () => {
    await clearScreenSubtitle(id);
    setBurnSubtitles(false);
    setSubPhase('idle');
    await reload();
  };

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center">
          <div className="rounded-md border border-border-default bg-bg-primary px-8 py-6 text-center">
            <p className="text-sm text-recording-strong">{loadError}</p>
            <Link href="/library" className="mt-3 inline-block text-xs text-primary-600 underline">
              返回录制库
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!meta || !videoUrl) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center text-sm text-text-tertiary">加载录制…</div>
      </div>
    );
  }

  const hasAudio = meta.hasMic || meta.hasSystemAudio;
  const hasSrt = !!meta.subtitleSrt;

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <AppHeader tier={subscription.tier} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: video + meta */}
        <div className="flex-1 overflow-auto px-7 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-baseline gap-3">
              <Link
                href="/library"
                className="text-text-tertiary hover:text-text-primary"
                aria-label="返回"
              >
                <I.ChevronLeft size={18} />
              </Link>
              <h1 className="text-[22px] font-bold leading-tight">录制完成</h1>
              <span className="text-[12px] text-text-tertiary">
                {Math.round(meta.durationMs / 1000)} 秒 · {meta.output.width}×{meta.output.height}
              </span>
            </div>
            <video
              src={videoUrl}
              controls
              className="aspect-video w-full rounded-md bg-black shadow-md"
            />
          </div>
        </div>

        {/* Right: action rail */}
        <aside className="w-[420px] flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-primary p-6">
          <div className="space-y-5">
            {/* ===== Section: 下载 ===== */}
            <div>
              <h3 className="mb-2 text-[13px] font-semibold text-text-primary">下载视频</h3>
              <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
                {proUnlocked
                  ? '✓ 已订阅 Pro · 导出无水印'
                  : '免费版导出右下角带 excalicast.cc 水印；升级 Pro 后所有录制均可重下 clean 版'}
              </p>

              {/* Format picker */}
              <div className="mb-3 grid grid-cols-3 gap-2">
                <FormatButton
                  label="MP4"
                  sub="最广兼容"
                  selected={format === 'mp4'}
                  onClick={() => setFormat('mp4')}
                />
                <FormatButton
                  label="MOV"
                  sub="Mac / 剪辑软件"
                  selected={format === 'mov'}
                  onClick={() => setFormat('mov')}
                />
                <FormatButton
                  label="WebM"
                  sub="体积最小"
                  selected={format === 'webm'}
                  onClick={() => setFormat('webm')}
                />
              </div>
              <p className="mb-3 text-[10.5px] text-text-tertiary">
                {format === 'mp4' && 'H.264 + AAC · Windows / Mac QuickTime / Linux / iOS / Android / 抖音 / B 站 / YouTube 全平台兼容'}
                {format === 'mov' && 'H.264 + AAC · 与 MP4 同编码，.mov 容器。适合 Final Cut / Premiere 二次剪辑'}
                {format === 'webm' && 'VP9 + Opus · 体积约 MP4 的 70%，浏览器原生。Mac QuickTime 不支持，需用 VLC 或 Chrome 打开'}
              </p>

              {/* Burn-in subtitles toggle (shown only when SRT exists) */}
              {hasSrt && (
                <button
                  type="button"
                  onClick={() => setBurnSubtitles((v) => !v)}
                  className={`mb-3 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition ${
                    burnSubtitles
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
                  }`}
                >
                  <span
                    className="mt-0.5 grid h-[16px] w-[16px] flex-shrink-0 place-items-center rounded-md border-2"
                    style={{ borderColor: burnSubtitles ? 'var(--primary-600)' : 'var(--border-strong)' }}
                  >
                    {burnSubtitles && <I.Check size={11} sw={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-text-primary">
                      字幕烧入视频
                    </div>
                    <div className="text-[11px] text-text-tertiary">
                      {burnSubtitles
                        ? '下载的 MP4 会带硬字幕（每帧固定显示，所有播放器可见）'
                        : '不烧入字幕，下载纯净视频'}
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={handleDownload}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md disabled:opacity-50"
                style={{ background: 'var(--primary-600)' }}
              >
                <I.Download size={16} />
                下载 {format.toUpperCase()} {proUnlocked ? '（无水印）' : '（含水印）'}
              </button>

              {progress && (
                <div className="mt-3 rounded-md border border-border-default bg-bg-secondary p-3 text-[12px]">
                  <div className="text-text-primary">
                    {progress.phase === 'loading' && '加载中…'}
                    {progress.phase === 'transcoding' && `转码中 ${Math.round(progress.ratio * 100)}%`}
                    {progress.phase === 'done' && '已完成'}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded bg-bg-tertiary">
                    <div
                      className="h-full bg-primary-600 transition-all"
                      style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border-default" />

            {/* ===== Section: Pro 进阶 ===== */}
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                进阶服务
                {!subtitlePerm && (
                  <span
                    className="ml-auto rounded-md px-2 py-1 text-[11px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                  >
                    需要 Pro
                  </span>
                )}
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-text-secondary">
                自动识别音频生成字幕，下载时一键烧入视频
              </p>

              {/* Subtitle feature card */}
              <div className="rounded-lg border border-border-default bg-bg-secondary p-3.5">
                <div className="flex items-start gap-3">
                  <div
                    className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-white"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                  >
                    <I.Subtitles size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-text-primary">视频字幕</div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary">
                      DashScope ASR · 中英文自动识别
                    </div>
                  </div>
                </div>

                {!hasAudio && (
                  <div className="mt-3 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[11px] text-yellow-900">
                    ⚠️ 该录制没有音频轨，无法生成字幕
                  </div>
                )}

                {hasAudio && !subtitlePerm && (
                  <div className="mt-3 text-[11px] text-text-tertiary">
                    升级 Pro 后即可生成字幕
                  </div>
                )}

                {hasAudio && subtitlePerm && !hasSrt && subPhase === 'idle' && (
                  <button
                    type="button"
                    onClick={() => void startSubtitleJob()}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                  >
                    <I.Sparkles size={12} /> 生成字幕
                  </button>
                )}

                {(subPhase === 'extracting' || subPhase === 'pending' || subPhase === 'running') && (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-border-default bg-bg-primary p-2.5 text-[11.5px]">
                    <span
                      className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700"
                      aria-hidden
                    />
                    <span className="text-text-primary">
                      {subPhase === 'extracting' && '提取音频…'}
                      {subPhase === 'pending' && '已提交识别任务，等待开始…'}
                      {subPhase === 'running' && '转写中（约 30-60 秒）…'}
                    </span>
                  </div>
                )}

                {subPhase === 'done' && hasSrt && (
                  <>
                    {subMockReason && (
                      <div className="mt-3 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[11px] text-yellow-900">
                        ⚠️ {subMockReason}
                      </div>
                    )}
                    <div className="mt-3 rounded-md border border-success-300 bg-success-50 px-3 py-2 text-[11.5px] text-success-700">
                      ✓ 字幕已生成 · 下载时勾选「字幕烧入视频」即可
                    </div>
                  </>
                )}

                {subPhase === 'failed' && (
                  <div className="mt-3 rounded-md border border-recording-strong bg-red-50 p-2.5 text-[11.5px] text-recording-strong">
                    <div className="font-semibold">字幕生成失败</div>
                    <div className="mt-1">{subError}</div>
                    <button
                      type="button"
                      onClick={() => void startSubtitleJob()}
                      className="mt-2 rounded-md border border-current px-2 py-1 text-[11px] font-semibold"
                    >
                      重试
                    </button>
                  </div>
                )}

                {hasSrt && subPhase !== 'extracting' && subPhase !== 'pending' && subPhase !== 'running' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-default pt-3">
                    <button
                      type="button"
                      onClick={() => downloadSrt(meta.subtitleSrt!, `excalicast_${id.slice(0, 8)}.srt`)}
                      className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-primary px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:bg-bg-tertiary"
                    >
                      <I.Download size={11} /> 单独下载 SRT
                    </button>
                    <button
                      type="button"
                      onClick={() => void startSubtitleJob()}
                      className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-primary px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-tertiary"
                    >
                      <I.Sparkles size={11} /> 重新生成
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveSubtitle()}
                      className="ml-auto text-[11px] text-text-tertiary underline-offset-2 hover:text-recording-strong hover:underline"
                    >
                      移除字幕
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FormatButton({
  label,
  sub,
  selected,
  onClick,
}: {
  label: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 text-center transition ${
        selected
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
      }`}
    >
      <span className={`text-[12.5px] font-bold ${selected ? 'text-primary-700' : 'text-text-primary'}`}>
        {label}
      </span>
      <span className="text-[10px] text-text-tertiary">{sub}</span>
    </button>
  );
}
