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
        className="relative mx-auto overflow-hidden"
        style={{
          aspectRatio: `${aspect}`,
          maxHeight: '52vh',
          background: 'var(--paper)',
          border: '1.5px solid var(--ink)',
          borderRadius: 3,
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
        />

        <div
          className="absolute left-3 top-3 flex items-center gap-1.5"
          style={{
            padding: '3px 10px',
            background: config.withWatermark ? 'var(--hi)' : 'var(--pro)',
            border: '1.2px solid var(--ink)',
            borderRadius: 999,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
          }}
        >
          {config.withWatermark ? t('watermarkBadge') : t('cleanBadge')}
        </div>

        {rendering && !exporting && (
          <span
            className="absolute right-3 top-3"
            style={{
              padding: '2px 8px',
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.04em',
              borderRadius: 2,
            }}
          >
            {t('renderingTag')}
          </span>
        )}
        {error && (
          <span
            className="absolute inset-x-3 bottom-3"
            style={{
              padding: '6px 12px',
              background: 'var(--rec)',
              color: 'var(--paper)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              borderRadius: 3,
              border: '1.3px solid var(--ink)',
            }}
          >
            {t('previewFailed', { message: error })}
          </span>
        )}

        {!exporting && (
          <div
            className="absolute inset-x-4 bottom-3 flex items-center gap-2"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              padding: '6px 10px',
              borderRadius: 3,
              border: '1.3px solid var(--ink)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {(timeMs / 1000).toFixed(1)}s
            </span>
            <input
              type="range"
              min={0}
              max={metadata.durationMs}
              step={Math.max(1, Math.round(metadata.durationMs / 200))}
              value={timeMs}
              onChange={(e) => setTimeMs(Number(e.target.value))}
              className="h-1 flex-1"
              style={{ accentColor: 'var(--hi)' }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                opacity: 0.85,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {(metadata.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        )}

        {exporting && (
          <div
            className="fade-in absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(26, 26, 26, 0.55)' }}
          >
            <div
              className="w-[80%] max-w-[340px] px-5 py-4"
              style={{
                background: 'var(--paper)',
                border: '1.8px solid var(--ink)',
                borderRadius: 4,
                boxShadow: '4px 4px 0 var(--ink)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 flex-shrink-0">
                  <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--rule-soft)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="var(--ink)"
                      strokeWidth="3"
                      strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dasharray 200ms' }}
                    />
                  </svg>
                  <span
                    className="absolute inset-0 grid place-items-center tabular-nums"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--ink)' }}
                  >
                    {pct}%
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.005em' }}>
                    {t('generating')}
                  </div>
                  <div
                    className="mt-0.5 truncate"
                    style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
                  >
                    {phaseLabel}
                  </div>
                </div>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden"
                style={{ background: 'var(--paper-3)', border: '1px solid var(--ink)', borderRadius: 999 }}
              >
                <div
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, background: 'var(--hi)' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <p
        style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}
      >
        {t('caption')}
      </p>
    </div>
  );
}
