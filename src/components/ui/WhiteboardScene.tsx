import type { CSSProperties, JSX } from 'react';

/** Excalidraw-style hand-drawn rectangle (single rough rounded path). */
function RoughRect({ x, y, w, h, stroke = 'var(--ink)', sw = 1.6, fillColor }: { x: number; y: number; w: number; h: number; stroke?: string; sw?: number; fillColor?: string }): JSX.Element {
  const r = 4;
  const p1 = `M ${x + r + 1} ${y - 0.4} L ${x + w - r + 0.5} ${y + 0.6} Q ${x + w + 1} ${y - 0.2} ${x + w + 0.4} ${y + r + 0.4} L ${x + w - 0.5} ${y + h - r} Q ${x + w + 0.6} ${y + h + 0.8} ${x + w - r - 0.2} ${y + h - 0.2} L ${x + r} ${y + h + 0.6} Q ${x - 0.6} ${y + h + 0.4} ${x - 0.4} ${y + h - r} L ${x + 0.4} ${y + r} Q ${x - 0.3} ${y - 0.2} ${x + r + 1} ${y - 0.4} Z`;
  return (
    <>
      {fillColor && <path d={p1} fill={fillColor} />}
      <path d={p1} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Hand-drawn curved arrow with head. */
function RoughArrow({ x1, y1, x2, y2, stroke = 'var(--ink)', sw = 1.6, curve = 8, dash = false }: { x1: number; y1: number; x2: number; y2: number; stroke?: string; sw?: number; curve?: number; dash?: boolean }): JSX.Element {
  const mx = (x1 + x2) / 2 + curve * 0.2;
  const my = (y1 + y2) / 2 - curve;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const ah = 9;
  const ax1 = x2 - Math.cos(ang - 0.5) * ah;
  const ay1 = y2 - Math.sin(ang - 0.5) * ah;
  const ax2 = x2 - Math.cos(ang + 0.5) * ah;
  const ay2 = y2 - Math.sin(ang + 0.5) * ah;
  return (
    <>
      <path d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash ? '5 4' : 'none'} strokeLinecap="round" />
      <path d={`M ${ax1} ${ay1} L ${x2} ${y2} L ${ax2} ${ay2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Hand-drawn Excalidraw scene used as the hero / share-player canvas content.
 * `animate` adds the `.draw-loop` class so strokes continuously self-draw —
 * makes the hero feel like a live recording. MotionLayer measures stroke
 * lengths (--len); loop speed via --loop-dur. */
export function WhiteboardScene({
  variant = 'default',
  style = {},
  animate = false,
}: {
  variant?: 'default' | 'auth';
  style?: CSSProperties;
  animate?: boolean;
}): JSX.Element {
  const cls = animate ? 'draw-loop' : undefined;
  const aStyle = animate ? ({ ...style, ['--loop-dur' as string]: '9s' } as CSSProperties) : style;
  if (variant === 'auth') {
    return (
      <svg className={cls} viewBox="0 0 800 460" style={{ width: '100%', height: '100%', ...aStyle }}>
        <RoughRect x={60} y={60} w={170} h={90} fillColor="#FFF8E0" />
        <text x={145} y={110} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="22" fill="#1A1A1A">Client App</text>
        <RoughRect x={320} y={60} w={170} h={90} fillColor="#FBF8FF" />
        <text x={405} y={102} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="20" fill="#1A1A1A">Auth Server</text>
        <text x={405} y={124} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#6B6B66">(OAuth 2.0)</text>
        <RoughRect x={580} y={60} w={170} h={90} fillColor="#E6F3EA" />
        <text x={665} y={110} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="22" fill="#1A1A1A">Resource API</text>
        <RoughRect x={320} y={290} w={170} h={90} fillColor="#FFEEEE" />
        <text x={405} y={335} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="20" fill="#1A1A1A">Token Store</text>
        <RoughArrow x1={230} y1={105} x2={320} y2={105} curve={-4} />
        <RoughArrow x1={490} y1={105} x2={580} y2={105} curve={-4} />
        <RoughArrow x1={405} y1={150} x2={405} y2={290} curve={6} />
        <RoughArrow x1={320} y1={335} x2={145} y2={150} curve={-30} dash />
        <text x={250} y={88} fontFamily="var(--font-hand)" fontSize="18" fill="#DC2626">1. auth req</text>
        <text x={510} y={88} fontFamily="var(--font-hand)" fontSize="18" fill="#2F8A3F">2. token</text>
        <text x={420} y={230} fontFamily="var(--font-hand)" fontSize="18" fill="#1A1A1A">3. persist</text>
        <text x={210} y={230} fontFamily="var(--font-hand)" fontSize="18" fill="#6B6B66" fontStyle="italic">refresh flow</text>
        <path d="M 348 270 q 60 -15 110 0 q 20 5 -10 12 q -45 8 -100 0 z" fill="#FFD166" opacity="0.55" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 800 460" style={{ width: '100%', height: '100%', ...aStyle }}>
      <RoughRect x={50} y={180} w={150} h={80} fillColor="#FFF8E0" />
      <text x={125} y={218} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="22" fill="#1A1A1A">User</text>
      <text x={125} y={240} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#6B6B66">(browser)</text>
      <RoughRect x={290} y={70} w={170} h={80} fillColor="#FBF8FF" />
      <text x={375} y={108} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="20" fill="#1A1A1A">Canvas Engine</text>
      <text x={375} y={130} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#6B6B66">Event stream</text>
      <RoughRect x={290} y={290} w={170} h={80} fillColor="#E6F3EA" />
      <text x={375} y={328} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="20" fill="#1A1A1A">Audio Track</text>
      <text x={375} y={350} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#6B6B66">Opus / 32 kbps</text>
      <RoughRect x={560} y={180} w={180} h={80} fillColor="#FFEEEE" />
      <text x={650} y={218} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="20" fill="#1A1A1A">ffmpeg.wasm</text>
      <text x={650} y={240} textAnchor="middle" fontFamily="var(--font-hand)" fontSize="14" fill="#6B6B66">local render</text>
      <RoughArrow x1={200} y1={210} x2={290} y2={110} curve={-12} />
      <RoughArrow x1={200} y1={230} x2={290} y2={330} curve={12} />
      <RoughArrow x1={460} y1={110} x2={560} y2={210} curve={-8} />
      <RoughArrow x1={460} y1={330} x2={560} y2={230} curve={8} />
      <RoughArrow x1={650} y1={260} x2={150} y2={260} curve={40} dash />
      <text x={220} y={155} fontFamily="var(--font-hand)" fontSize="16" fill="#1A1A1A">draws</text>
      <text x={220} y={310} fontFamily="var(--font-hand)" fontSize="16" fill="#1A1A1A">speaks</text>
      <text x={485} y={170} fontFamily="var(--font-hand)" fontSize="16" fill="#1A1A1A">events</text>
      <text x={485} y={310} fontFamily="var(--font-hand)" fontSize="16" fill="#1A1A1A">audio</text>
      <text x={380} y={270} fontFamily="var(--font-hand)" fontSize="16" fill="#DC2626">MP4 download</text>
      <path d="M 545 165 q 100 -10 215 0 q 18 95 5 110 q -120 12 -220 0 q -10 -50 0 -110 z" fill="none" stroke="#FFD166" strokeWidth={3.5} opacity="0.9" strokeLinecap="round" />
    </svg>
  );
}
