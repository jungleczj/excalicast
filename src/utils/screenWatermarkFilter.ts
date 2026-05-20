/**
 * Build a single-string ffmpeg -vf filter that overlays an `excalicast.cc`
 * watermark in the bottom-right corner (or bottom-left when camera bubble
 * is sitting in the bottom-right).
 *
 * Assumes a font file is already in ffmpeg's virtual FS at `watermark-latin.ttf`.
 *
 * Returns a `-vf` value (NOT `-filter_complex`). drawtext's built-in `box=1`
 * gives us the translucent dark pill behind the text — no separate drawbox
 * filter needed, which keeps the syntax minimal and robust.
 */
export function buildScreenWatermarkFilter(opts: {
  hasCamera: boolean;
  videoH: number;
}): string {
  const corner = opts.hasCamera ? 'bl' : 'br';
  const fontSize = Math.max(14, Math.round(opts.videoH * 0.022));
  const marginX = Math.round(opts.videoH * 0.025);
  const marginY = Math.round(opts.videoH * 0.04);
  const boxBorder = Math.max(8, Math.round(fontSize * 0.6));

  // ffmpeg drawtext positioning vars:
  //   W, H = input frame dims
  //   tw, th = rendered text width/height (after font shaping)
  // Position the bottom-edge of text `marginY` from bottom; right-edge
  // (or left-edge) `marginX` from the respective side.
  const xExpr = corner === 'br' ? `W-tw-${marginX}` : `${marginX}`;
  const yExpr = `H-th-${marginY}`;

  // Compose a single drawtext filter. Spaces and commas inside the value
  // are fine; only `:` separates drawtext options.
  return [
    'drawtext=fontfile=watermark-latin.ttf',
    `text='excalicast.cc'`,
    `fontcolor=white@0.95`,
    `fontsize=${fontSize}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `box=1`,
    `[email protected]`,
    `boxborderw=${boxBorder}`,
    `shadowcolor=black@0.5`,
    `shadowx=1`,
    `shadowy=1`,
  ].join(':');
}
