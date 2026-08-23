'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState, type RefObject } from 'react';

const Excalidraw = dynamic(
  async () => {
    // 自托管 Excalidraw 字体/资源：指向同源 /excalidraw-assets[-dev]/，
    // 否则默认回退 unpkg CDN，CDN 不可达时整块 chunk 加载失败（ChunkLoadError）。
    if (typeof window !== 'undefined') {
      (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
    }
    return (await import('@excalidraw/excalidraw')).Excalidraw;
  },
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary" /> },
);

export interface WhiteboardChangeFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>): void;
}

interface Props {
  onChangeRef: RefObject<WhiteboardChangeFn | null>;
  /** Excalidraw API ready 后回调一次，用于上层拿 api 来 setActiveTool 等（激光笔等） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onApiReady?: (api: any) => void;
  /**
   * 激光笔轨迹采集：每次 onPointerUpdate 且 tool==='laser' 时调用一次。
   * 上层在 session 起动后把 session.recordLaserPoint 赋给这个 ref，停止/discard 时清回 null。
   */
  laserPointRef?: RefObject<((x: number, y: number, button: 'down' | 'up') => void) | null>;
  pointerPointRef?: RefObject<((x: number, y: number, button: 'down' | 'up', tool: string) => void) | null>;
  /** Desktop transparent overlay keeps Excalidraw's native library/sidebar surface available. */
  fullToolSurface?: boolean;
  /** Do not paint the regular web workspace paper behind Excalidraw. */
  transparentBackground?: boolean;
}

export default function Whiteboard({
  onChangeRef,
  onApiReady,
  laserPointRef,
  pointerPointRef,
  fullToolSurface = false,
  transparentBackground = false,
}: Props): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const [, setApiReady] = useState(false);

  const handlers = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      onChangeRef.current?.(elements, appState, files);
    },
  }), [onChangeRef]);

  return (
    <div className={`excalicast-board${fullToolSurface ? ' excalicast-board--full-tools' : ''} absolute inset-0${transparentBackground ? '' : ' bg-canvas-bg'}`}>
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawAPI={(api: any) => { apiRef.current = api; setApiReady(true); onApiReady?.(api); }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={handlers.onChange as any}
        initialData={transparentBackground ? {
          appState: { viewBackgroundColor: 'transparent' },
        } : undefined}
        onPointerUpdate={({ pointer, button }) => {
          pointerPointRef?.current?.(pointer.x, pointer.y, button, pointer.tool);
          if (pointer.tool === 'laser') laserPointRef?.current?.(pointer.x, pointer.y, button);
        }}
      />
    </div>
  );
}
