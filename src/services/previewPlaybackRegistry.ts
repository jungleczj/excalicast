interface PlaybackSource {
  setPlayback?: (playing: boolean, timeMs: number) => Promise<void>;
}

interface PlaybackIntent {
  playing: boolean;
  timeMs: number;
}

export class PreviewPlaybackRegistry {
  private readonly intents = new Map<string, PlaybackIntent>();
  private readonly sources = new Map<string, PlaybackSource>();

  setIntent(recordingId: string, playing: boolean, timeMs: number): void {
    const intent = { playing, timeMs };
    this.intents.set(recordingId, intent);
    const source = this.sources.get(recordingId);
    void source?.setPlayback?.(playing, timeMs).catch(() => undefined);
  }

  async attach(recordingId: string, source: PlaybackSource): Promise<void> {
    this.sources.set(recordingId, source);
    const intent = this.intents.get(recordingId);
    if (intent) await source.setPlayback?.(intent.playing, intent.timeMs);
  }

  detach(recordingId: string, source?: PlaybackSource): void {
    if (source && this.sources.get(recordingId) !== source) return;
    this.sources.delete(recordingId);
  }

  clear(recordingId: string): void {
    this.sources.delete(recordingId);
    this.intents.delete(recordingId);
  }
}

export const previewPlaybackRegistry = new PreviewPlaybackRegistry();
