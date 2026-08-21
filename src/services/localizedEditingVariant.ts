import type { KeyPointMotionSegment, LocalizedTrack, RecordingMetadata } from '@/types/recording';

export interface LocalizedEditingVariant {
  subtitleSrt: string;
  keyPointMotions: KeyPointMotionSegment[];
  localizedTrackId: string | null;
  language: 'source' | 'en';
}

/** Keeps source-language editing assets separate from each generated language track. */
export function resolveLocalizedEditingVariant(
  metadata: Pick<RecordingMetadata, 'subtitleSrt' | 'keyPointMotions'>,
  localizedTrack: LocalizedTrack | null | undefined,
): LocalizedEditingVariant {
  if (localizedTrack) {
    return {
      subtitleSrt: localizedTrack.translatedSrt,
      keyPointMotions: localizedTrack.keyPointMotions ?? [],
      localizedTrackId: localizedTrack.id,
      language: 'en',
    };
  }
  return {
    subtitleSrt: metadata.subtitleSrt ?? '',
    keyPointMotions: metadata.keyPointMotions ?? [],
    localizedTrackId: null,
    language: 'source',
  };
}
