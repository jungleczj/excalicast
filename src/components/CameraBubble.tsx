'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';

interface Props {
  stream: MediaStream | null;
  size?: number;
  shape?: 'circle' | 'rounded';
  position: { x: number; y: number };
  onPositionChange: (next: { x: number; y: number }) => void;
}

/**
 * 摄像头浮窗 — 设计稿 DraggableBubble：
 *  - 圆形 + 白色 3px 描边 + 阴影
 *  - 实时预览镜像水平翻转（用户视角）
 *  - 没有 stream 时显示占位脸
 *  - 右上角 Drag 指示点（hover 状态显示）
 */
export function CameraBubble({ stream, size = 160, shape = 'circle', position, onPositionChange }: Props): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      onPositionChange({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onPositionChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    setDragging(true);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="fade-in fixed z-40 select-none overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size,
        height: size,
        borderRadius: shape === 'circle' ? '50%' : 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px rgba(255,255,255,0.9)',
        background: stream ? '#1f2937' : 'linear-gradient(135deg, #fde68a, #fbbf24)',
        cursor: dragging ? 'grabbing' : 'grab',
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <FacePlaceholder />
      )}

      <div
        className="pointer-events-none absolute right-2 top-2 grid h-[22px] w-[22px] place-items-center rounded-full text-white"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
      >
        <I.Drag size={11} />
      </div>
    </div>
  );
}

function FacePlaceholder(): JSX.Element {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="faceBg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#faceBg)" />
      <ellipse cx="50" cy="105" rx="45" ry="30" fill="#1e3a8a" />
      <circle cx="50" cy="55" r="22" fill="#fcd9b6" />
      <path d="M 28 50 Q 30 35 50 32 Q 70 35 72 50 Q 68 42 50 42 Q 32 42 28 50" fill="#3f2e1e" />
      <path d="M 42 62 Q 50 68 58 62" stroke="#7c2d12" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="42" cy="55" r="1.5" fill="#1f2937" />
      <circle cx="58" cy="55" r="1.5" fill="#1f2937" />
    </svg>
  );
}
