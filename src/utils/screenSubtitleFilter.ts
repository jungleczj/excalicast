import type { SubtitleCue } from '@/types/recording';

/**
 * Build a series of ffmpeg drawtext filters that hard-burn SRT cues into
 * the video using `enable='between(t,startSec,endSec)'`.
 *
 * Returns a list of `drawtext=...` filter clauses that the caller chains
 * with commas inside `-vf`. Each cue becomes its own drawtext stage.
 *
 * Why not the `subtitles=` filter? ffmpeg.wasm core does not ship with
 * libass; `subtitles=` would fail. `drawtext` is plain freetype and works
 * out of the box.
 *
 * Safety: text is escaped for ffmpeg drawtext (escape `:` `\` `'`).
 */
export function buildSubtitleDrawtextFilters(
  cues: SubtitleCue[],
  videoH: number,
): string[] {
  if (cues.length === 0) return [];
  const fontSize = Math.max(20, Math.round(videoH * 0.038));
  const boxBorder = Math.max(8, Math.round(fontSize * 0.4));
  // Bottom 10% of frame, centered.
  const marginBottom = Math.round(videoH * 0.08);

  return cues.map((c) => {
    const startSec = (c.startMs / 1000).toFixed(3);
    const endSec = (c.endMs / 1000).toFixed(3);
    const text = escapeDrawtextText(c.text);
    return [
      'drawtext=fontfile=watermark-latin.ttf',  // reuse the font we already bundled
      `text='${text}'`,
      `fontcolor=white`,
      `fontsize=${fontSize}`,
      `x=(W-tw)/2`,
      `y=H-th-${marginBottom}`,
      `box=1`,
      `[email protected]`,
      `boxborderw=${boxBorder}`,
      `shadowcolor=black@0.6`,
      `shadowx=1`,
      `shadowy=1`,
      `enable='between(t,${startSec},${endSec})'`,
    ].join(':');
  });
}

/**
 * Escape text for use inside ffmpeg drawtext `text='...'`.
 * Special chars: `\`, `'`, `:`, `%`. Also newlines collapse to space.
 */
function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\n+/g, ' ')
    .trim();
}
