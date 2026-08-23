'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Whiteboard, { type WhiteboardChangeFn } from '@/components/Whiteboard';
import {
  DESKTOP_IPC_CHANNELS,
  normalizeDesktopInkSettings,
  type DesktopInkRuntimeState,
  type DesktopInkSettings,
} from '@/desktop/productContract';
import { createDesktopInkSurfacePresentation } from '@/desktop/inkSurface';
import { DesktopInkEventCollector } from '@/desktop/inkEventJournal';
import { DesktopInkUnifiedProducer, shouldCollectDesktopInk } from '@/desktop/desktopInkUnifiedProducer';

type DesktopInkViewState = DesktopInkRuntimeState;

const DEFAULT_SETTINGS: DesktopInkViewState = {
  ...normalizeDesktopInkSettings({
    mode: 'ink', backgroundOpacity: 0, inkOpacity: 1, pointerPolicy: 'draw',
  }),
  recordingActive: false,
  recordingId: null,
  paused: false,
  visible: true,
};

export default function DesktopInkPage(): JSX.Element {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const changeRef = useRef<WhiteboardChangeFn | null>(null);
  const pointerPointRef = useRef<((x: number, y: number, button: 'down' | 'up', tool: string) => void) | null>(null);
  const collectorRef = useRef(new DesktopInkEventCollector());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const recordingActiveRef = useRef(false);
  const recordingIdRef = useRef<string | null>(null);
  const producerRef = useRef<DesktopInkUnifiedProducer | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const flushInFlightRef = useRef<Promise<void>>(Promise.resolve());
  const presentation = useMemo(
    () => createDesktopInkSurfacePresentation(settings),
    [settings],
  );

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRoot = root.style.background;
    const previousBody = body.style.background;
    root.style.background = 'transparent';
    body.style.background = 'transparent';
    const bridge = window.excalicastDesktop;
    if (!bridge) return () => {
      root.style.background = previousRoot;
      body.style.background = previousBody;
    };
    void bridge.invoke(DESKTOP_IPC_CHANNELS.inkGetSettings).then((value) => {
      if (isInkSettings(value)) setSettings({
        ...normalizeDesktopInkSettings(value),
        visible: value.visible,
        windowID: value.windowID,
        recordingActive: value.recordingActive,
        recordingId: value.recordingId,
        paused: value.paused,
      });
    });
    const unsubscribe = bridge.subscribe(DESKTOP_IPC_CHANNELS.inkSettingsChanged, (value) => {
      if (isInkSettings(value)) setSettings({
        ...normalizeDesktopInkSettings(value),
        visible: value.visible,
        windowID: value.windowID,
        recordingActive: value.recordingActive,
        recordingId: value.recordingId,
        paused: value.paused,
      });
    });
    return () => {
      unsubscribe();
      root.style.background = previousRoot;
      body.style.background = previousBody;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetMode, {
        mode: settings.mode,
        pointerPolicy: 'pass-through',
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settings.mode]);

  const flushEvents = useCallback((): Promise<void> => {
    flushTimerRef.current = null;
    const operation = flushInFlightRef.current.then(async () => {
      const producer = producerRef.current;
      if (!producer?.hasPending) return;
      try {
        await producer.flush();
      } catch {
        if (recordingActiveRef.current) {
          flushTimerRef.current = window.setTimeout(() => {
            void flushEvents().catch(() => undefined);
          }, 250);
        }
        throw new Error('desktop_ink_event_flush_failed');
      }
    });
    flushInFlightRef.current = operation.catch(() => undefined);
    return operation;
  }, []);
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      void flushEvents().catch(() => undefined);
    }, 100);
  }, [flushEvents]);

  useEffect(() => {
    const bridge = window.excalicastDesktop;
    if (!bridge) return;
    return bridge.subscribe(DESKTOP_IPC_CHANNELS.inkFlushRequested, (value) => {
      if (!value || typeof value !== 'object') return;
      const requestId = (value as Record<string, unknown>).requestId;
      if (typeof requestId !== 'string') return;
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      void flushEvents().then(() => (
        bridge.invoke(DESKTOP_IPC_CHANNELS.inkFlushComplete, { requestId })
      )).catch(() => undefined);
    });
  }, [flushEvents]);

  useEffect(() => {
    const bridge = window.excalicastDesktop;
    const collectionEnabled = shouldCollectDesktopInk(settings);
    recordingActiveRef.current = collectionEnabled;
    if (bridge && settings.recordingId && settings.recordingId !== recordingIdRef.current) {
      recordingIdRef.current = settings.recordingId;
      collectorRef.current = new DesktopInkEventCollector();
      producerRef.current = new DesktopInkUnifiedProducer({
        bridge,
        collector: collectorRef.current,
        sessionId: settings.recordingId,
        producerEpoch: crypto.randomUUID(),
        nowHostUs: () => Math.round(performance.now() * 1_000),
      });
      const api = apiRef.current;
      if (api && collectionEnabled) {
        collectorRef.current.observeScene(
          api.getSceneElementsIncludingDeleted?.() ?? api.getSceneElements?.() ?? [],
          api.getAppState?.() ?? {},
          api.getFiles?.() ?? {},
          Date.now(),
        );
        scheduleFlush();
      }
    }
    if (!collectionEnabled && flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (collectionEnabled && producerRef.current?.hasPending) scheduleFlush();
    if (!settings.recordingActive) {
      recordingIdRef.current = null;
      producerRef.current = null;
    }
  }, [scheduleFlush, settings.paused, settings.recordingActive, settings.recordingId]);

  const handleSceneChange = useCallback<WhiteboardChangeFn>((elements, appState, files) => {
    if (!recordingActiveRef.current) return;
    collectorRef.current.observeScene(elements, appState, files, Date.now());
    scheduleFlush();
  }, [scheduleFlush]);
  const handlePointerPoint = useCallback<NonNullable<typeof pointerPointRef.current>>((x, y, button, tool) => {
    if (!recordingActiveRef.current) return;
    collectorRef.current.recordPointer({
      x, y, tool, phase: button === 'up' ? 'up' : 'move',
    }, Date.now());
    scheduleFlush();
  }, [scheduleFlush]);
  changeRef.current = handleSceneChange;
  pointerPointRef.current = handlePointerPoint;

  return (
    <main
      className={presentation.className}
      data-testid="desktop-ink-surface"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: presentation.boardBackground,
        ['--desktop-ink-opacity' as string]: presentation.inkOpacity,
      }}
    >
      <Whiteboard
        onChangeRef={changeRef}
        onApiReady={(api) => { apiRef.current = api; }}
        pointerPointRef={pointerPointRef}
        fullToolSurface={presentation.fullToolSurface}
        transparentBackground
      />
      <InkControls settings={settings} />
    </main>
  );
}

function InkControls({ settings }: { settings: DesktopInkViewState }): JSX.Element {
  const setMode = (mode: DesktopInkSettings['mode']) => {
    void window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetMode, {
      mode,
      pointerPolicy: 'draw',
    });
  };
  const setOpacity = (patch: Partial<Pick<DesktopInkSettings, 'backgroundOpacity' | 'inkOpacity'>>) => {
    void window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetOpacity, {
      backgroundOpacity: patch.backgroundOpacity ?? settings.backgroundOpacity,
      inkOpacity: patch.inkOpacity ?? settings.inkOpacity,
    });
  };
  return (
    <section
      aria-label="Desktop ink controls"
      className="rb-no-record"
      style={{
        position: 'fixed', right: 16, top: 16, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        color: 'var(--ink)', background: 'var(--paper)', border: '1.5px solid var(--ink)',
        borderRadius: 4, boxShadow: '2px 2px 0 var(--ink)', fontFamily: 'var(--font-mono)',
      }}
    >
      <button type="button" aria-pressed={settings.mode === 'ink'} onClick={() => setMode('ink')}>Ink</button>
      <button type="button" aria-pressed={settings.mode === 'full-board'} onClick={() => setMode('full-board')}>Board</button>
      <label>
        Board opacity
        <input
          aria-label="Board opacity"
          type="range" min={0} max={100} step={1}
          value={Math.round(settings.backgroundOpacity * 100)}
          onChange={(event) => setOpacity({ backgroundOpacity: Number(event.target.value) / 100 })}
        />
      </label>
      <label>
        Ink opacity
        <input
          aria-label="Ink opacity"
          type="range" min={0} max={100} step={1}
          value={Math.round(settings.inkOpacity * 100)}
          onChange={(event) => setOpacity({ inkOpacity: Number(event.target.value) / 100 })}
        />
      </label>
      <button
        type="button"
        onClick={() => void window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetMode, {
          mode: settings.mode,
          pointerPolicy: 'pass-through',
        })}
      >
        Pass through
      </button>
    </section>
  );
}

function isInkSettings(value: unknown): value is DesktopInkRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<DesktopInkSettings>;
  return (settings.mode === 'ink' || settings.mode === 'full-board')
    && (settings.pointerPolicy === 'draw' || settings.pointerPolicy === 'pass-through')
    && typeof settings.backgroundOpacity === 'number'
    && typeof settings.inkOpacity === 'number'
    && typeof (value as DesktopInkRuntimeState).visible === 'boolean'
    && typeof (value as DesktopInkRuntimeState).recordingActive === 'boolean'
    && typeof (value as DesktopInkRuntimeState).paused === 'boolean'
    && (((value as DesktopInkRuntimeState).recordingActive
      && typeof (value as DesktopInkRuntimeState).recordingId === 'string')
      || (!(value as DesktopInkRuntimeState).recordingActive
        && (value as DesktopInkRuntimeState).recordingId === null));
}
