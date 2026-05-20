/**
 * Build the ffmpeg -filter_complex argument that overlays an `excalicast.cc`
 * watermark in the bottom-right corner (or bottom-left when camera is present).
 *
 * Assumes a font file is already inside ffmpeg's virtual FS at `watermark-latin.ttf`.
 *
 * Returned filter graph input label is `[0:v]` (the source video) and the final
 * label is `[wm]`. The caller maps `[wm]` to the output.
 */
export function buildScreenWatermarkFilter(opts: {
  hasCamera: boolean;
  videoH: number;
}): string {
  const corner = opts.hasCamera ? 'bl' : 'br';
  const fontSize = Math.max(14, Math.round(opts.videoH * 0.022));

  // Box geometry: roughly text-width-aware, but ffmpeg drawtext doesn't expose tw
  // before drawing. We use drawbox at a known size that fits "excalicast.cc" at
  // the chosen fontSize.
  const boxW = Math.round(fontSize * 10);     // ~10 chars including padding
  const boxH = Math.round(fontSize * 1.8);
  const marginX = Math.round(opts.videoH * 0.025);
  const marginY = Math.round(opts.videoH * 0.04);

  // X / Y of the watermark box, expressed as ffmpeg expressions
  const xExpr = corner === 'br' ? `W-w-${marginX}` : `${marginX}`;
  const yExpr = `H-h-${marginY}`;

  // drawbox creates a semi-transparent dark pill; drawtext writes the URL inside.
  // x_drawtext / y_drawtext are absolute inside the frame.
  const textXExpr = corner === 'br'
    ? `W-${boxW + marginX} + (${boxW}-tw)/2`
    : `${marginX} + (${boxW}-tw)/2`;
  const textYExpr = `H-${boxH + marginY} + (${boxH}-th)/2`;

  return [
    `[0:v]drawbox=x=${xExpr}:y=${yExpr}:w=${boxW}:h=${boxH}:[email protected]:t=fill[bg]`,
    `[bg]drawtext=fontfile=watermark-latin.ttf:text='excalicast.cc'` +
      `:fontcolor=white@0.95:fontsize=${fontSize}` +
      `:x=${textXExpr}:y=${textYExpr}` +
      `:shadowcolor=black@0.4:shadowx=1:shadowy=1[wm]`,
  ].join(';');
}
