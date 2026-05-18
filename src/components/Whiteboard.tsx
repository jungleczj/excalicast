'use client';

import dynamic from 'next/dynamic';
import { useMemo, type RefObject } from 'react';

const Excalidraw = dynamic(
  async () => (await import('@excalidraw/excalidraw')).Excalidraw,
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-tertiary" /> },
);

export interface WhiteboardChangeFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>): void;
}

interface Props {
  onChangeRef: RefObject<WhiteboardChangeFn | null>;
}

export default function Whiteboard({ onChangeRef }: Props): JSX.Element {
  const handlers = useMemo(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (elements: readonly any[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      onChangeRef.current?.(elements, appState, files);
    },
  }), [onChangeRef]);

  return (
    <div className="excalicast-board absolute inset-0 bg-canvas-bg">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Excalidraw onChange={handlers.onChange as any} />
    </div>
  );
}
