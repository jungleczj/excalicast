'use client';

import { useTranslations } from 'next-intl';
import type { DesktopDirectorJobStatus } from '@/desktop/productContract';
import type { RecordingMetadata } from '@/types/recording';
import type { NativeTeachingCompositionLifecycle } from '@/types/recording';

export type DirectorProgressPhase = 'pending' | 'generating' | 'ready' | 'unsupported' | 'failed' | 'unknown';

export function hasDesktopDirectorProgress(
  teachingStatus: RecordingMetadata['teachingRecipeStatus'],
  director: DesktopDirectorJobStatus | undefined,
  composition: NativeTeachingCompositionLifecycle | undefined,
): boolean {
  return Boolean(teachingStatus || director || composition);
}

export function resolveDesktopDirectorPhase(
  teachingStatus: RecordingMetadata['teachingRecipeStatus'],
  director: DesktopDirectorJobStatus | undefined,
  composition?: NativeTeachingCompositionLifecycle,
): DirectorProgressPhase {
  if (composition?.status === 'unsupported') return 'unsupported';
  if (composition?.status === 'failed' || director?.status === 'failed') return 'failed';
  if (composition?.status === 'pending') return director?.status === 'generating' ? 'generating' : 'pending';
  if (composition?.status === 'generating') return 'generating';
  if (composition?.status === 'ready') return director && director.status !== 'ready' ? director.status : 'ready';
  if (teachingStatus === 'error') return 'failed';
  if (director?.status === 'generating') return 'generating';
  if (director?.status === 'pending') return 'pending';
  if (teachingStatus === 'ready' && (!director || director.status === 'ready')) return 'ready';
  if (director?.status === 'ready') return 'generating';
  if (teachingStatus === 'pending') return 'pending';
  return 'unknown';
}

export function DesktopDirectorProgress({
  teachingStatus,
  director,
  composition,
  placementCount,
  onRetry,
  onRetryComposition,
  onPreview,
}: {
  teachingStatus: RecordingMetadata['teachingRecipeStatus'];
  director?: DesktopDirectorJobStatus;
  composition?: NativeTeachingCompositionLifecycle;
  placementCount: number;
  onRetry?: () => void;
  onRetryComposition?: () => void;
  onPreview?: () => void;
}): JSX.Element | null {
  const t = useTranslations('desktopDirector');
  if (!hasDesktopDirectorProgress(teachingStatus, director, composition)) return null;
  const phase = resolveDesktopDirectorPhase(teachingStatus, director, composition);
  const compositionCode = composition?.status === 'failed' || composition?.status === 'unsupported'
    ? composition.code
    : undefined;
  const retryComposition = phase === 'failed'
    && composition?.status === 'failed'
    && composition.retryable
    && onRetryComposition;
  const retryDirector = !retryComposition && phase === 'failed' && director?.retryable === true && onRetry;

  return (
    <section
      className="desktop-studio-director"
      data-phase={phase}
      data-testid="desktop-director-progress"
      role={phase === 'failed' ? 'alert' : 'status'}
      aria-live={phase === 'failed' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="desktop-studio-director__mark" aria-hidden="true" />
      <div className="desktop-studio-director__copy">
        <span className="desktop-studio-director__eyebrow">{t('eyebrow')}</span>
        <strong>{t(`phase.${phase}`)}</strong>
        <small>
          {phase === 'ready'
            ? t('placements', { count: placementCount })
            : (phase === 'failed' || phase === 'unsupported') && (compositionCode || director?.code)
              ? t(phase === 'unsupported' ? 'unsupportedCode' : 'failedCode', { code: compositionCode ?? director?.code })
              : t(`detail.${phase}`)}
        </small>
      </div>
      <div className="desktop-studio-director__actions">
        {phase === 'ready' && onPreview && (
          <button type="button" onClick={onPreview}>{t('preview')}</button>
        )}
        {retryComposition && (
          <button type="button" data-testid="desktop-composition-retry" onClick={onRetryComposition}>
            {t('retryComposition')}
          </button>
        )}
        {retryDirector && (
          <button type="button" data-testid="desktop-director-retry" onClick={onRetry}>{t('retry')}</button>
        )}
      </div>
    </section>
  );
}
