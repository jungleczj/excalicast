'use client';

import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { ASPECT_PRESETS, type AspectRatio, type CropWindow } from '@/types/recording';

interface Props {
  /** 固定比例或自定义（'default' 不应渲染本组件）。 */
  framing: AspectRatio | 'custom';
  /** 受控裁切框（画布区比例 0..1）；null 时 overlay 测量后按目标比例居中初始化。 */
  value: CropWindow | null;
  onChange: (next: CropWindow) => void;
  /** Custom 输出像素（W×H 输入显示用）。 */
  customOutput?: { width: number; height: number };
  onCustomOutputChange?: (o: { width: number; height: number }) => void;
  /** 是否可交互（取景态 true：可拖边/缩放/输入；录制态 false：纯视觉，不挡画布/工具栏）。 */
  interactive: boolean;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_PX = 48;

/** 把像素帧缩放到 ≤1920 盒子内、取偶，作为 Custom 输出尺寸。 */
function deriveOutput(w: number, h: number): { width: number; height: number } {
  const cap = 1920;
  const s = Math.min(1, cap / Math.max(w, h));
  const ev = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: ev(w), height: ev(h) };
}

/**
 * 录制中画布上的裁切框 viewfinder（照设计 recording.jsx CropFrame）+ 可交互：
 * 整框拖拽移动、四角缩放（预设锁比例 / Custom 自由）、Custom 框旁 W×H 输入两向联动。
 * 蒙层与框内 pointer-events:none（不挡作画），仅边/角手柄 + Custom 输入可点。
 */
export function AspectCropOverlay({ framing, value, onChange, customOutput, onCustomOutputChange, interactive }: Props): JSX.Element {
  const t = useTranslations('recordingSetup');
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ mode: 'move' | Corner; startX: number; startY: number; frame: { x: number; y: number; w: number; h: number } } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCustom = framing === 'custom';
  const targetAspect = isCustom
    ? (customOutput && customOutput.height > 0 ? customOutput.width / customOutput.height : 16 / 9)
    : ASPECT_PRESETS[framing].width / ASPECT_PRESETS[framing].height;

  // value 为 null 时按目标比例居中初始化（contain-fit 90%）
  useEffect(() => {
    if (value || !size || size.w <= 0 || size.h <= 0) return;
    const availW = size.w * 0.9;
    const availH = size.h * 0.9;
    let w: number, h: number;
    if (availW / availH > targetAspect) { h = availH; w = h * targetAspect; }
    else { w = availW; h = w / targetAspect; }
    onChange({ rx: (size.w - w) / 2 / size.w, ry: (size.h - h) / 2 / size.h, rw: w / size.w, rh: h / size.h });
  }, [value, size, targetAspect, onChange]);

  // 当前帧（px）
  const frame = value && size ? { x: value.rx * size.w, y: value.ry * size.h, w: value.rw * size.w, h: value.rh * size.h } : null;

  const commit = (f: { x: number; y: number; w: number; h: number }) => {
    if (!size) return;
    let w = Math.max(MIN_PX, Math.min(size.w, f.w));
    let h = Math.max(MIN_PX, Math.min(size.h, f.h));
    let x = Math.max(0, Math.min(size.w - w, f.x));
    let y = Math.max(0, Math.min(size.h - h, f.y));
    onChange({ rx: x / size.w, ry: y / size.h, rw: w / size.w, rh: h / size.h });
    if (isCustom) onCustomOutputChange?.(deriveOutput(w, h));
  };

  const onPointerDown = (mode: 'move' | Corner) => (e: React.MouseEvent) => {
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, frame: { ...frame } };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !size) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (d.mode === 'move') {
        commit({ ...d.frame, x: d.frame.x + dx, y: d.frame.y + dy });
        return;
      }
      // 四角缩放：anchor = 被拖角的对角（固定）
      const f = d.frame;
      const anchor = {
        x: d.mode === 'tl' || d.mode === 'bl' ? f.x + f.w : f.x,
        y: d.mode === 'tl' || d.mode === 'tr' ? f.y + f.h : f.y,
      };
      const mouseX = f.x + (d.mode === 'tl' || d.mode === 'bl' ? 0 : f.w) + dx;
      const mouseY = f.y + (d.mode === 'tl' || d.mode === 'tr' ? 0 : f.h) + dy;
      let rawW = mouseX - anchor.x;
      let rawH = mouseY - anchor.y;
      if (!isCustom) {
        // 锁比例：以宽为准推高，保持方向
        const w = Math.abs(rawW);
        let h = w / targetAspect;
        if (h > size.h) { h = size.h; }
        rawW = Math.sign(rawW || 1) * (h * targetAspect);
        rawH = Math.sign(rawH || 1) * h;
      }
      commit({
        x: Math.min(anchor.x, anchor.x + rawW),
        y: Math.min(anchor.y, anchor.y + rawH),
        w: Math.abs(rawW),
        h: Math.abs(rawH),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Custom W×H 输入 → 设比例，围绕框中心重绘
  const applyCustomDims = (width: number, height: number) => {
    onCustomOutputChange?.({ width, height });
    if (!frame || !size || width <= 0 || height <= 0) return;
    const aspect = width / height;
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    let w = frame.w;
    let h = w / aspect;
    if (h > size.h) { h = size.h; w = h * aspect; }
    if (w > size.w) { w = size.w; h = w / aspect; }
    onChange({
      rx: Math.max(0, Math.min(size.w - w, cx - w / 2)) / size.w,
      ry: Math.max(0, Math.min(size.h - h, cy - h / 2)) / size.h,
      rw: w / size.w,
      rh: h / size.h,
    });
  };

  const dim = (l: number, tp: number, w: number, h: number): CSSProperties => ({
    position: 'absolute', left: l, top: tp, width: Math.max(0, w), height: Math.max(0, h),
    background: 'rgba(252,249,244,0.54)', pointerEvents: 'none', zIndex: 15,
  });

  const handleStyle: CSSProperties = {
    position: 'absolute', width: 16, height: 16, background: 'rgba(255,253,248,0.96)',
    border: '1px solid rgba(84,156,220,0.52)', borderRadius: 999, zIndex: 24, pointerEvents: 'auto',
    boxShadow: '0 10px 24px rgba(48,38,26,0.10)',
  };

  return (
    <div ref={ref} className="crop-craft-overlay rb-no-record pointer-events-none absolute inset-0 z-20">
      {frame && size && (
        <>
          {/* 框外蒙层 */}
          <div style={dim(0, 0, size.w, frame.y)} />
          <div style={dim(0, frame.y + frame.h, size.w, size.h - frame.y - frame.h)} />
          <div style={dim(0, frame.y, frame.x, frame.h)} />
          <div style={dim(frame.x + frame.w, frame.y, size.w - frame.x - frame.w, frame.h)} />

          {/* 虚线框（纯视觉，不拦截点击 —— 保证框内作画/工具栏可用） */}
          <div
            className="crop-craft-frame"
            style={{
              position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h,
              border: '1.5px dashed rgba(84,156,220,0.74)', borderRadius: 18, zIndex: 20,
              pointerEvents: 'none', background: 'transparent',
            }}
          />

          {/* 取景态：四条细边拖拽条移动整框；框内部不设热区，不挡画布 */}
          {interactive && [
            { left: frame.x, top: frame.y - 7, width: frame.w, height: 14 },
            { left: frame.x, top: frame.y + frame.h - 7, width: frame.w, height: 14 },
            { left: frame.x - 7, top: frame.y, width: 14, height: frame.h },
            { left: frame.x + frame.w - 7, top: frame.y, width: 14, height: frame.h },
          ].map((s, i) => (
            <div
              key={i}
              onMouseDown={onPointerDown('move')}
              style={{ position: 'absolute', left: s.left, top: s.top, width: s.width, height: s.height, zIndex: 21, pointerEvents: 'auto', cursor: 'move' }}
            />
          ))}

          {/* 四角括号 + 缩放手柄 */}
          {([
            { c: 'tl' as Corner, left: frame.x - 6, top: frame.y - 6, path: 'M0 16 L0 0 L16 0', cursor: 'nwse-resize' },
            { c: 'tr' as Corner, left: frame.x + frame.w - 10, top: frame.y - 6, path: 'M0 0 L16 0 L16 16', cursor: 'nesw-resize' },
            { c: 'bl' as Corner, left: frame.x - 6, top: frame.y + frame.h - 10, path: 'M0 0 L0 16 L16 16', cursor: 'nesw-resize' },
            { c: 'br' as Corner, left: frame.x + frame.w - 10, top: frame.y + frame.h - 10, path: 'M16 0 L16 16 L0 16', cursor: 'nwse-resize' },
          ]).map((c) => (
            <div key={c.c}>
              <svg className="crop-craft-corner" width="18" height="18" style={{ position: 'absolute', left: c.left, top: c.top, zIndex: 22, pointerEvents: 'none' }}>
                <path d={c.path} stroke="rgba(84,156,220,0.88)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
              </svg>
              {interactive && (
                <div
                  onMouseDown={onPointerDown(c.c)}
                  style={{
                    ...handleStyle, cursor: c.cursor,
                    left: c.c === 'tl' || c.c === 'bl' ? frame.x - 8 : frame.x + frame.w - 8,
                    top: c.c === 'tl' || c.c === 'tr' ? frame.y - 8 : frame.y + frame.h - 8,
                  }}
                />
              )}
            </div>
          ))}

          {/* 比例徽标：预设始终显示；Custom 非取景态显示折叠徽标 */}
          {(!isCustom || !interactive) && (
            <div
              className="crop-craft-badge"
              style={{
                position: 'absolute', left: frame.x + 12, top: frame.y + 12,
                padding: '4px 10px', background: 'var(--hi)', border: '1.4px solid var(--ink)', borderRadius: 2,
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', zIndex: 23, pointerEvents: 'none',
              }}
            >
              {isCustom
                ? `${customOutput?.width ?? Math.round(frame.w)}×${customOutput?.height ?? Math.round(frame.h)}`
                : framing} · {t('cropLocked')}
            </div>
          )}

          {/* Custom 框旁 W×H 输入：仅取景态可调 */}
          {isCustom && interactive && (
            <div
              className="crop-craft-dim-popover flex items-center"
              style={{
                position: 'absolute',
                left: Math.min(size.w - 196, frame.x + frame.w + 8),
                top: Math.max(0, frame.y),
                gap: 6, padding: 6, background: 'var(--paper)', border: '1.4px solid var(--ink)', borderRadius: 3,
                boxShadow: '2px 2px 0 var(--ink)', zIndex: 25, pointerEvents: 'auto',
              }}
            >
              <DimInput label={t('aspect.customWidth')} value={customOutput?.width ?? Math.round(frame.w)} onCommit={(v) => applyCustomDims(v, customOutput?.height ?? Math.round(frame.h))} />
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>×</span>
              <DimInput label={t('aspect.customHeight')} value={customOutput?.height ?? Math.round(frame.h)} onCommit={(v) => applyCustomDims(customOutput?.width ?? Math.round(frame.w), v)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DimInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }): JSX.Element {
  return (
    <label className="flex flex-col" style={{ gap: 2 }}>
      <span className="label-mono" style={{ fontSize: 8 }}>{label}</span>
      <input
        className="crop-craft-dim-input"
        type="number"
        min={120}
        max={4096}
        defaultValue={value}
        key={value}
        onBlur={(e) => onCommit(Math.max(1, Number(e.target.value) || 0))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 56, border: '1.2px solid var(--ink)', borderRadius: 2, padding: '3px 6px', fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--paper)', color: 'var(--ink)' }}
      />
    </label>
  );
}
