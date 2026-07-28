'use client';

import { useEffect, useRef, useState } from 'react';
import { I } from '@/components/icons';

interface Props {
  stream: MediaStream | null;
  size?: number;
  shape?: 'circle' | 'rounded';
  position: { x: number; y: number };
  onPositionChange: (next: { x: number; y: number }) => void;
  /** 拖动右下角手柄缩放气泡边长（px）。不传则不显示缩放手柄。 */
  onSizeChange?: (next: number) => void;
}

// 气泡边长范围（与 CLAUDE.md 摄像头规格一致）
const MIN_SIZE = 80;
const MAX_SIZE = 480;

/**
 * 摄像头浮窗 — 设计稿 DraggableBubble：
 *  - 圆形 + 白色 3px 描边 + 阴影
 *  - 实时预览镜像水平翻转（用户视角）
 *  - 没有 stream 时显示占位脸
 *  - 右上角 Drag 指示点（hover 状态显示）
 */
export function CameraBubble({ stream, size = 160, shape = 'circle', position, onPositionChange, onSizeChange }: Props): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!dragging) return;
    // rAF 节流：mousemove 可达 60-120Hz，合并到每帧最多回调一次，
    // 避免每个 mousemove 都触发父级 setState 重渲染造成拖拽卡顿。
    let raf: number | null = null;
    let pending: { x: number; y: number } | null = null;
    const flush = () => {
      raf = null;
      if (pending) { onPositionChange(pending); pending = null; }
    };
    const onMove = (e: MouseEvent) => {
      pending = {
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      };
      if (raf === null) raf = requestAnimationFrame(flush);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [dragging, onPositionChange]);

  // 缩放：右下角手柄，左上角(position)为锚点，边长 = 鼠标相对锚点的较大轴距，钳到 [80,480]
  useEffect(() => {
    if (!resizing || !onSizeChange) return;
    let raf: number | null = null;
    let pending: number | null = null;
    const flush = () => {
      raf = null;
      if (pending != null) { onSizeChange(pending); pending = null; }
    };
    const onMove = (e: MouseEvent) => {
      const next = Math.max(e.clientX - position.x, e.clientY - position.y);
      pending = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, next)));
      if (raf === null) raf = requestAnimationFrame(flush);
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [resizing, onSizeChange, position.x, position.y]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    setDragging(true);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    // 阻断冒泡：避免触发外层拖拽
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
  };

  return (
    <div
      data-testid="camera-bubble"
      onMouseDown={handleMouseDown}
      className="camera-craft-bubble fade-in fixed z-40 select-none overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size,
        height: size,
        borderRadius: shape === 'circle' ? '50%' : 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 0 0 3px rgba(255,255,255,0.9)',
        // 不论是否有 stream 都用深色 ink-2 —— 跟有流时的暗色 video placeholder 衔接，
        // 避免颜色突变给用户"在切换什么东西"的错觉。
        background: '#1f2937',
        cursor: resizing ? 'nwse-resize' : dragging ? 'grabbing' : 'grab',
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
        <CameraIdlePlaceholder size={size} />
      )}

      {onSizeChange && (
        <div
          onMouseDown={handleResizeMouseDown}
          title="拖动缩放"
          className="absolute bottom-0 right-0 h-8 w-8"
          style={{ cursor: 'nwse-resize' }}
        />
      )}
    </div>
  );
}

/**
 * stream 尚未就绪时的中性占位：深色背景里居中一个摄像头图标，配 1.6 s 慢呼吸动效。
 * 出现窗口很短 —— 主要在点击开始 / 停止录制的过渡期。
 */
function CameraIdlePlaceholder({ size }: { size: number }): JSX.Element {
  const iconSize = Math.max(20, Math.round(size * 0.3));
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ color: 'rgba(255,255,255,0.7)' }}
    >
      <div className="camera-idle-pulse">
        <I.Camera size={iconSize} sw={1.6} />
      </div>
    </div>
  );
}
