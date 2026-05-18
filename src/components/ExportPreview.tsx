'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { renderPreviewFrame } from '@/services/exportPipeline';
import type { ExportConfig, RecordingMetadata } from '@/types/recording';
import { ASPECT_PRESETS } from '@/types/recording';
import type { ExportProgressState } from '@/components/ExportPanel';

interface Props {
  recordingId: string;
  metadata: RecordingMetadata;
  config: ExportConfig;
  progress?: ExportProgressState | null;
}

export function ExportPreview({ recordingId, metadata, config, progress }: Props): JSX.Element {
  const t = useTranslations('exportPreview');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeMs, setTimeMs] = useState<number>(0);
  const [rendering, setRendering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const renderToken = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const my = ++renderToken.current;
    setRendering(true);
    setError(null);
    renderPreviewFrame(recordingId, timeMs, config, canvasRef.current)
      .catch((err) => { if (renderToken.current === my) setError(err instanceof Error ? err.message : 'render_failed'); })
      .finally(() => { if (renderToken.current === my) setRendering(false); });
  }, [recordingId, timeMs, config]);

  const preset = ASPECT_PRESETS[config.aspectRatio];
  const aspect = preset.width / preset.height;

  const exporting = progress != null;
  const pct = exporting ? Math.round((progress?.ratio ?? 0) * 100) : 0;
  const phaseKey = progress?.phase ?? '';
  let phaseLabel = '';
  if (exporting) {
    try {
      phaseLabel = t(`phase.${phaseKey}` as never);
    } catch {
      phaseLabel = phaseKey;
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-[#0a0a0a] shadow-md"
        style={{ aspectRatio: `${aspect}`, maxHeight: '52vh' }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
        />

        <div
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold text-white"
          style={{
            background: config.withWatermark ? 'rgba(245, 158, 11, 0.95)' : 'rgba(16, 185, 129, 0.95)',
          }}
        >
          {config.withWatermark ? t('watermarkBadge') : t('cleanBadge')}
        </div>

        {rendering && !exporting && (
          <span className="absolute right-3 top-3 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/70">{t('renderingTag')}</span>
        )}
        {error && (
          <span className="absolute inset-x-3 bottom-3 rounded bg-recording-strong px-3 py-1.5 text-[11px] text-white">{t('previewFailed', { message: error })}</span>
        )}

        {!exporting && (
          <div className="absolute inset-x-4 bottom-3 flex items-center gap-2 text-white">
            <span className="font-mono text-[11px] opacity-85">{(timeMs / 1000).toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={metadata.durationMs}
              step={Math.max(1, Math.round(metadata.durationMs / 200))}
              value={timeMs}
              onChange={(e) => setTimeMs(Number(e.target.value))}
              className="h-1 flex-1 accent-white"
            />
            <span className="font-mono text-[11px] opacity-85">{(metadata.durationMs / 1000).toFixed(1)}s</span>
          </div>
        )}

        {exporting && (
          <div
            className="fade-in absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          >
            <div className="w-[80%] max-w-[320px] rounded-2xl bg-bg-primary px-5 py-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 flex-shrink-0">
                  <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--bg-tertiary)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="var(--primary-600)"
                      strokeWidth="3"
                      strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dasharray 200ms' }}
                    />
                  </svg>
                  <span className="absolute inset-0 grid place-items-center font-mono text-[10px] font-bold text-text-primary tabular-nums">{pct}%</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-text-primary">{t('generating')}</div>
                  <div className="mt-0.5 truncate text-[11px] text-text-tertiary">{phaseLabel}</div>
                </div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full bg-primary-600 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-tertiary">{t('caption')}</p>
    </div>
  );
}
