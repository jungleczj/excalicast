import type { JSX } from 'react';

/**
 * 录制库卡片的手绘插画封面（移植设计稿 parts/whiteboard.jsx 的 RoughRect/RoughArrow
 * + parts/library.jsx 的 ThumbScene 风格）。按 recording id 确定性选一个场景，
 * 全部为设计手绘风（不依赖真实录制内容）。viewBox 240×135 ≈ 16:9。
 */

function RoughRect({ x, y, w, h, fillColor }: { x: number; y: number; w: number; h: number; fillColor: string }): JSX.Element {
  const r = 4;
  const p = `M ${x + r + 1} ${y - 0.4}
             L ${x + w - r + 0.5} ${y + 0.6}
             Q ${x + w + 1} ${y - 0.2} ${x + w + 0.4} ${y + r + 0.4}
             L ${x + w - 0.5} ${y + h - r}
             Q ${x + w + 0.6} ${y + h + 0.8} ${x + w - r - 0.2} ${y + h - 0.2}
             L ${x + r} ${y + h + 0.6}
             Q ${x - 0.6} ${y + h + 0.4} ${x - 0.4} ${y + h - r}
             L ${x + 0.4} ${y + r}
             Q ${x - 0.3} ${y - 0.2} ${x + r + 1} ${y - 0.4} Z`;
  return (
    <>
      <path d={p} fill={fillColor} />
      <path d={p} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function RoughArrow({ x1, y1, x2, y2, curve = 6 }: { x1: number; y1: number; x2: number; y2: number; curve?: number }): JSX.Element {
  const mx = (x1 + x2) / 2 + curve * 0.2;
  const my = (y1 + y2) / 2 - curve;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const ah = 8;
  const ax1 = x2 - Math.cos(ang - 0.5) * ah;
  const ay1 = y2 - Math.sin(ang - 0.5) * ah;
  const ax2 = x2 - Math.cos(ang + 0.5) * ah;
  const ay2 = y2 - Math.sin(ang + 0.5) * ah;
  return (
    <>
      <path d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" />
      <path d={`M ${ax1} ${ay1} L ${x2} ${y2} L ${ax2} ${ay2}`} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

// 三个手绘场景（boxes + arrows），均 240×135
const SCENES: (() => JSX.Element)[] = [
  // 0 · nodes + arrows
  () => (
    <>
      <RoughRect x={26} y={42} w={62} h={44} fillColor="#FFF8E0" />
      <RoughRect x={150} y={26} w={56} h={40} fillColor="#FBF8FF" />
      <RoughRect x={150} y={80} w={56} h={40} fillColor="#E6F3EA" />
      <RoughArrow x1={88} y1={58} x2={150} y2={46} />
      <RoughArrow x1={88} y1={70} x2={150} y2={100} />
    </>
  ),
  // 1 · pipeline (app → cache → db)
  () => (
    <>
      <RoughRect x={20} y={50} w={50} h={40} fillColor="#FFF8E0" />
      <RoughRect x={96} y={50} w={50} h={40} fillColor="#FFD166" />
      <RoughRect x={172} y={50} w={50} h={40} fillColor="#E6F3EA" />
      <RoughArrow x1={70} y1={70} x2={96} y2={70} curve={-2} />
      <RoughArrow x1={146} y1={70} x2={172} y2={70} curve={-2} />
    </>
  ),
  // 2 · flow (box → diamond → box)
  () => (
    <>
      <RoughRect x={22} y={52} w={48} h={34} fillColor="#FFF8E0" />
      <path d="M 120 48 L 142 70 L 120 92 L 98 70 Z" fill="#FBF8FF" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
      <RoughRect x={170} y={52} w={48} h={34} fillColor="#FFEEEE" />
      <RoughArrow x1={70} y1={69} x2={98} y2={70} curve={-2} />
      <RoughArrow x1={142} y1={70} x2={170} y2={69} curve={-2} />
    </>
  ),
];

function pickScene(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % SCENES.length;
}

export function ThumbScene({ seed }: { seed: string }): JSX.Element {
  const Scene = SCENES[pickScene(seed)];
  return (
    <svg viewBox="0 0 240 135" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {Scene()}
    </svg>
  );
}
