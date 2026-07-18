'use client';

import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { SourceCropWindow } from '@/types/recording';

interface Props {
  value: SourceCropWindow | null;
  mediaAspect: number | null;
  onChange: (next: SourceCropWindow) => void;
  label?: string;
}

const MIN_SIZE = 0.1;
const DEFAULT_CROP: SourceCropWindow = { rx: 0.1, ry: 0.1, rw: 0.8, rh: 0.8 };

function clampCrop(crop: SourceCropWindow): SourceCropWindow {
  const rw = Math.max(MIN_SIZE, Math.min(1, crop.rw));
  const rh = Math.max(MIN_SIZE, Math.min(1, crop.rh));
  return {
    rx: Math.max(0, Math.min(1 - rw, crop.rx)),
    ry: Math.max(0, Math.min(1 - rh, crop.ry)),
    rw,
    rh,
  };
}

function contentBox(container: DOMRect, mediaAspect: number | null): { x: number; y: number; w: number; h: number } {
  if (!mediaAspect || mediaAspect <= 0 || container.width <= 0 || container.height <= 0) {
    return { x: 0, y: 0, w: container.width, h: container.height };
  }
  const containerAspect = container.width / container.height;
  if (containerAspect > mediaAspect) {
    const h = container.height;
    const w = h * mediaAspect;
    return { x: (container.width - w) / 2, y: 0, w, h };
  }
  const w = container.width;
  const h = w / mediaAspect;
  return { x: 0, y: (container.height - h) / 2, w, h };
}

export function DisplaySourceCropOverlay({ value, mediaAspect, onChange, label }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!value) onChange(DEFAULT_CROP);
  }, [value, onChange]);

  const crop = value ?? DEFAULT_CROP;

  const clientToCropPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = ref.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const box = contentBox(rect, mediaAspect);
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left - box.x) / box.w)),
      y: Math.max(0, Math.min(1, (clientY - rect.top - box.y) / box.h)),
    };
  };

  const updateFromDrag = (clientX: number, clientY: number) => {
    if (!dragStart) return;
    const point = clientToCropPoint(clientX, clientY);
    const rx = Math.min(dragStart.x, point.x);
    const ry = Math.min(dragStart.y, point.y);
    const rw = Math.abs(point.x - dragStart.x);
    const rh = Math.abs(point.y - dragStart.y);
    onChange(clampCrop({ rx, ry, rw, rh }));
  };

  const styleFromCrop = (): CSSProperties => {
    const el = ref.current;
    if (!el) {
      return {
        left: `${crop.rx * 100}%`,
        top: `${crop.ry * 100}%`,
        width: `${crop.rw * 100}%`,
        height: `${crop.rh * 100}%`,
      };
    }
    const rect = el.getBoundingClientRect();
    const box = contentBox(rect, mediaAspect);
    return {
      left: box.x + crop.rx * box.w,
      top: box.y + crop.ry * box.h,
      width: crop.rw * box.w,
      height: crop.rh * box.h,
    };
  };

  return (
    <div
      ref={ref}
      className="rb-no-record absolute inset-0 z-20"
      style={{ cursor: 'crosshair' }}
      onPointerDown={(event) => {
        event.preventDefault();
        const point = clientToCropPoint(event.clientX, event.clientY);
        setDragStart(point);
        onChange(clampCrop({ rx: point.x, ry: point.y, rw: MIN_SIZE, rh: MIN_SIZE }));
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragStart) updateFromDrag(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (dragStart) updateFromDrag(event.clientX, event.clientY);
        setDragStart(null);
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(11, 18, 24, .28)',
          WebkitMask: 'linear-gradient(#000 0 0)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          ...styleFromCrop(),
          border: '2px solid rgba(96, 165, 250, .95)',
          borderRadius: 22,
          boxShadow: '0 0 0 9999px rgba(11,18,24,.28), 0 14px 36px rgba(44,93,143,.18)',
          background: 'rgba(255,255,255,.03)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 12,
            top: 10,
            padding: '4px 9px',
            borderRadius: 999,
            background: 'rgba(255,253,248,.92)',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 750,
            boxShadow: '0 6px 16px rgba(24,25,26,.12)',
          }}
        >
          {label ?? 'Selected area'}
        </span>
        {['0 0', '100% 0', '0 100%', '100% 100%'].map((pos) => {
          const [left, top] = pos.split(' ');
          return (
            <i
              key={pos}
              aria-hidden
              style={{
                position: 'absolute',
                left,
                top,
                width: 12,
                height: 12,
                transform: 'translate(-50%, -50%)',
                borderRadius: 999,
                background: '#fffdf8',
                border: '2px solid rgba(96,165,250,.95)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
