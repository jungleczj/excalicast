'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import type { SourceCropWindow } from '@/types/recording';

interface Props {
  value: SourceCropWindow | null;
  mediaAspect: number | null;
  onChange: (next: SourceCropWindow) => void;
  label?: string;
  /** 录制后锁定选区，只保留边界作为所录范围的明确反馈。 */
  interactive?: boolean;
}

const MIN_SIZE = 0.1;
const DEFAULT_CROP: SourceCropWindow = { rx: 0.1, ry: 0.1, rw: 0.8, rh: 0.8 };

type Handle = 'nw' | 'ne' | 'sw' | 'se';
type DragState = {
  mode: 'create' | 'move' | 'resize';
  startX: number;
  startY: number;
  crop: SourceCropWindow;
  handle?: Handle;
};

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

function pointForEvent(event: PointerEvent<HTMLDivElement>, ref: RefObject<HTMLDivElement>): { x: number; y: number } {
  const el = ref.current;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  const box = contentBox(rect, Number(el.dataset.mediaAspect) || null);
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - box.x) / box.w)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top - box.y) / box.h)),
  };
}

function resizeCrop(base: SourceCropWindow, handle: Handle, x: number, y: number): SourceCropWindow {
  let left = base.rx;
  let right = base.rx + base.rw;
  let top = base.ry;
  let bottom = base.ry + base.rh;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - MIN_SIZE, x));
  else right = Math.min(1, Math.max(left + MIN_SIZE, x));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - MIN_SIZE, y));
  else bottom = Math.min(1, Math.max(top + MIN_SIZE, y));
  return clampCrop({ rx: left, ry: top, rw: right - left, rh: bottom - top });
}

export function DisplaySourceCropOverlay({ value, mediaAspect, onChange, label, interactive = true }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!value) onChange(DEFAULT_CROP);
  }, [value, onChange]);

  const crop = value ?? DEFAULT_CROP;

  const styleFromCrop = (): CSSProperties => {
    const el = ref.current;
    if (!el) return { left: `${crop.rx * 100}%`, top: `${crop.ry * 100}%`, width: `${crop.rw * 100}%`, height: `${crop.rh * 100}%` };
    const rect = el.getBoundingClientRect();
    const box = contentBox(rect, mediaAspect);
    return { left: box.x + crop.rx * box.w, top: box.y + crop.ry * box.h, width: crop.rw * box.w, height: crop.rh * box.h };
  };

  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const point = pointForEvent(event, ref);
    if (drag.mode === 'create') {
      onChange(clampCrop({
        rx: Math.min(drag.startX, point.x),
        ry: Math.min(drag.startY, point.y),
        rw: Math.max(MIN_SIZE, Math.abs(point.x - drag.startX)),
        rh: Math.max(MIN_SIZE, Math.abs(point.y - drag.startY)),
      }));
      return;
    }
    if (drag.mode === 'move') {
      onChange(clampCrop({
        ...drag.crop,
        rx: drag.crop.rx + point.x - drag.startX,
        ry: drag.crop.ry + point.y - drag.startY,
      }));
      return;
    }
    onChange(resizeCrop(drag.crop, drag.handle ?? 'se', point.x, point.y));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    const point = pointForEvent(event, ref);
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as Handle | undefined;
    const frame = target.closest('[data-crop-frame]');
    const next: DragState = handle
      ? { mode: 'resize', startX: point.x, startY: point.y, crop, handle }
      : frame
        ? { mode: 'move', startX: point.x, startY: point.y, crop }
        : { mode: 'create', startX: point.x, startY: point.y, crop };
    setDrag(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div
      ref={ref}
      data-media-aspect={mediaAspect ?? ''}
      className="rb-no-record absolute inset-0 z-20"
      style={{ cursor: interactive ? (drag ? 'grabbing' : 'crosshair') : 'default', pointerEvents: interactive ? 'auto' : 'none' }}
      onPointerDown={startDrag}
      onPointerMove={updateDrag}
      onPointerUp={(event) => { updateDrag(event); setDrag(null); }}
      onPointerCancel={() => setDrag(null)}
    >
      {interactive && <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(11,18,24,.16)', pointerEvents: 'none' }} />}
      <div
        data-testid="display-source-crop-frame"
        data-crop={`${crop.rx.toFixed(4)},${crop.ry.toFixed(4)},${crop.rw.toFixed(4)},${crop.rh.toFixed(4)}`}
        data-interactive={interactive ? 'true' : 'false'}
        data-crop-frame
        style={{
          position: 'absolute',
          ...styleFromCrop(),
          border: '2px solid rgba(96,165,250,.98)',
          borderRadius: 22,
          boxShadow: interactive ? '0 0 0 9999px rgba(11,18,24,.22), 0 14px 36px rgba(44,93,143,.18)' : '0 0 0 1px rgba(255,255,255,.72), 0 12px 28px rgba(44,93,143,.18)',
          background: 'rgba(255,255,255,.025)',
          cursor: interactive ? 'grab' : 'default',
        }}
      >
        <span
          style={{
            position: 'absolute', left: 12, top: 10, padding: '4px 9px', borderRadius: 999,
            background: 'rgba(255,253,248,.94)', color: 'var(--ink)', fontSize: 11, fontWeight: 750,
            boxShadow: '0 6px 16px rgba(24,25,26,.12)', pointerEvents: 'none',
          }}
        >
          {label ?? 'Selected area'}
        </span>
        {interactive && (['nw', 'ne', 'sw', 'se'] as Handle[]).map((handle) => {
          const left = handle.includes('w') ? '0' : '100%';
          const top = handle.includes('n') ? '0' : '100%';
          return (
            <i
              key={handle}
              data-crop-handle={handle}
              aria-hidden
              style={{
                position: 'absolute', left, top, width: 14, height: 14, transform: 'translate(-50%, -50%)',
                borderRadius: 999, background: '#fffdf8', border: '2px solid rgba(96,165,250,.98)', cursor: `${handle}-resize`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
