import type { LocalizedTrack } from '@/types/recording';

export function isUsableLocalizedTrack(track: LocalizedTrack | null | undefined): track is LocalizedTrack {
  if (!track || track.status !== 'ready' || track.audioBlob.size <= 44) return false;
  return !track.provider.toLowerCase().includes('mock');
}
