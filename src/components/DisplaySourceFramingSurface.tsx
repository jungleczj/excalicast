'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ASPECT_PRESETS, type RecordingSetupConfig, type SourceCropWindow } from '@/types/recording';
import { fitSourcePreview } from '@/services/displaySourceFraming';
import { DisplaySourceCropOverlay } from '@/components/DisplaySourceCropOverlay';
import { DisplaySourcePreview } from '@/components/DisplaySourcePreview';

interface Props {
  stream: MediaStream;
  sourceKind: NonNullable<RecordingSetupConfig['source']>['kind'];
  sourceSize?: { width: number; height: number };
  framing: RecordingSetupConfig['framing'];
  customOutput?: { width: number; height: number };
  crop: SourceCropWindow | null;
  onCropChange: (crop: SourceCropWindow) => void;
  onCustomOutputChange: (output: { width: number; height: number }) => void;
  onAspectChange: (aspect: number) => void;
  english: boolean;
}

function outputAspect(
  framing: RecordingSetupConfig['framing'],
  customOutput: Props['customOutput'],
): number | undefined {
  if (framing === 'default') return undefined;
  if (framing === 'custom') {
    return customOutput?.width && customOutput.height
      ? customOutput.width / customOutput.height
      : undefined;
  }
  const preset = ASPECT_PRESETS[framing];
  return preset.width / preset.height;
}

export function DisplaySourceFramingSurface({
  stream,
  sourceKind,
  sourceSize,
  framing,
  customOutput,
  crop,
  onCropChange,
  onCustomOutputChange,
  onAspectChange,
  english,
}: Props): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const aspect = sourceSize?.width && sourceSize.height ? sourceSize.width / sourceSize.height : 16 / 9;
  const lockedAspect = outputAspect(framing, customOutput);
  const needsCrop = sourceKind === 'selected_area' || framing !== 'default';

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const preview = useMemo(() => fitSourcePreview({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    sourceWidth: sourceSize?.width ?? aspect * 1000,
    sourceHeight: sourceSize?.height ?? 1000,
    zoom,
    panX: pan.x,
    panY: pan.y,
  }), [aspect, pan.x, pan.y, sourceSize?.height, sourceSize?.width, viewport.height, viewport.width, zoom]);

  const setFit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const setActualSize = useCallback(() => {
    const fitScale = Math.min(
      viewport.width / (sourceSize?.width ?? viewport.width),
      viewport.height / (sourceSize?.height ?? viewport.height),
    );
    setZoom(Math.max(1, Math.min(8, 1 / Math.max(0.01, fitScale))));
    setPan({ x: 0, y: 0 });
  }, [sourceSize?.height, sourceSize?.width, viewport.height, viewport.width]);

  const updateCrop = useCallback((next: SourceCropWindow) => {
    onCropChange(next);
    if (framing === 'custom' && sourceSize?.width && sourceSize.height) {
      onCustomOutputChange({
        width: Math.max(2, Math.round(sourceSize.width * next.rw / 2) * 2),
        height: Math.max(2, Math.round(sourceSize.height * next.rh / 2) * 2),
      });
    }
  }, [framing, onCropChange, onCustomOutputChange, sourceSize?.height, sourceSize?.width]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!panMode) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  };

  const labels = english
    ? { title: 'Frame the display source', fit: 'Fit', actual: '100%', pan: 'Pan', refresh: 'Refresh' }
    : { title: '框选显示源', fit: '适合窗口', actual: '100%', pan: '平移', refresh: '刷新画面' };

  return (
    <section
      data-testid="display-source-framing-surface"
      data-source-kind={sourceKind}
      data-preview-mode={sourceKind === 'current_tab' ? 'frozen' : 'live'}
      className="rb-no-record fixed inset-0 z-[35] flex flex-col items-center justify-center"
      style={{ padding: '74px 5vw 104px', background: 'rgba(18,19,20,.96)', pointerEvents: 'none' }}
    >
      <div className="mb-3 flex w-[90vw] items-center justify-between gap-4" style={{ color: '#fffdf8', pointerEvents: 'auto' }}>
        <strong style={{ fontSize: 14 }}>{labels.title}</strong>
        <div className="display-source-framing-tools flex items-center gap-2">
          <button type="button" onClick={setFit}>{labels.fit}</button>
          <button type="button" onClick={setActualSize}>{labels.actual}</button>
          <button type="button" aria-pressed={panMode} onClick={() => setPanMode((value) => !value)}>{labels.pan}</button>
          <button type="button" aria-label={english ? 'Zoom out' : '缩小'} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button>
          <span style={{ minWidth: 48, textAlign: 'center', fontSize: 12 }}>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label={english ? 'Zoom in' : '放大'} onClick={() => setZoom((value) => Math.min(8, value + 0.25))}>+</button>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)}>{labels.refresh}</button>
        </div>
      </div>
      <div
        ref={viewportRef}
        data-testid="display-source-live-preview"
        data-framing-viewport="true"
        className="relative h-[80dvh] w-[90vw] overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 190px)', background: '#0b0c0d', border: '1px solid rgba(255,255,255,.16)', borderRadius: 10, pointerEvents: 'auto' }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <div
          data-testid="display-source-framing-media"
          data-display-source-content-frame="true"
          className="absolute overflow-hidden"
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height, cursor: panMode ? 'grab' : 'default' }}
        >
          <DisplaySourcePreview
            stream={stream}
            freeze={sourceKind === 'current_tab'}
            refreshToken={refreshToken}
            onAspectChange={onAspectChange}
          />
          {needsCrop && !panMode && (
            <DisplaySourceCropOverlay
              value={crop}
              mediaAspect={aspect}
              lockedAspect={framing === 'custom' ? undefined : lockedAspect}
              onChange={updateCrop}
              label={english ? 'Output area' : '输出范围'}
            />
          )}
        </div>
      </div>
    </section>
  );
}
