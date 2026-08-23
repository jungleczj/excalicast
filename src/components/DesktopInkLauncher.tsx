'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { I } from '@/components/icons';
import {
  DESKTOP_IPC_CHANNELS,
  normalizeDesktopInkSettings,
  type DesktopInkSettings,
} from '@/desktop/productContract';

interface DesktopInkRuntimeState extends DesktopInkSettings {
  visible: boolean;
}

export function DesktopInkLauncher({ english }: { english: boolean }): JSX.Element | null {
  const [settings, setSettings] = useState<DesktopInkRuntimeState | null>(null);

  useEffect(() => {
    const bridge = window.excalicastDesktop;
    if (!bridge) return;
    const accept = (value: unknown) => {
      if (!isRuntimeState(value)) return;
      setSettings({ ...normalizeDesktopInkSettings(value), visible: value.visible });
    };
    void bridge.invoke(DESKTOP_IPC_CHANNELS.inkGetSettings).then(accept);
    return bridge.subscribe(DESKTOP_IPC_CHANNELS.inkSettingsChanged, accept);
  }, []);

  if (!settings) return null;
  const updateMode = async (
    mode: DesktopInkSettings['mode'],
    pointerPolicy: DesktopInkSettings['pointerPolicy'],
  ) => {
    const result = await window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetMode, {
      mode,
      pointerPolicy,
    });
    if (isRuntimeState(result)) {
      setSettings({ ...normalizeDesktopInkSettings(result), visible: result.visible });
    }
  };
  const updateOpacity = async (backgroundOpacity: number, inkOpacity: number) => {
    const result = await window.excalicastDesktop?.invoke(DESKTOP_IPC_CHANNELS.inkSetOpacity, {
      backgroundOpacity,
      inkOpacity,
    });
    if (isRuntimeState(result)) {
      setSettings({ ...normalizeDesktopInkSettings(result), visible: result.visible });
    }
  };

  return (
    <div className="rb-no-record fixed right-14 top-16 z-40 flex items-start gap-2">
      {settings.visible && (
        <div
          role="group"
          aria-label={english ? 'Desktop whiteboard settings' : '桌面白板设置'}
          className="pop-in flex items-center gap-2 px-3 py-2"
          style={{
            color: 'var(--ink)', background: 'rgba(255,253,248,.96)',
            border: '1.5px solid var(--ink)', borderRadius: 4,
            boxShadow: '2px 2px 0 var(--ink)', fontFamily: 'var(--font-mono)',
          }}
        >
          <ModeButton active={settings.mode === 'ink'} onClick={() => void updateMode('ink', 'draw')}>
            {english ? 'Ink' : '墨迹'}
          </ModeButton>
          <ModeButton active={settings.mode === 'full-board'} onClick={() => void updateMode('full-board', 'draw')}>
            {english ? 'Board' : '白板'}
          </ModeButton>
          <OpacityControl
            label={english ? 'Board opacity' : '白板透明度'}
            value={settings.backgroundOpacity}
            onChange={(value) => void updateOpacity(value, settings.inkOpacity)}
          />
          <OpacityControl
            label={english ? 'Ink opacity' : '笔迹透明度'}
            value={settings.inkOpacity}
            onChange={(value) => void updateOpacity(settings.backgroundOpacity, value)}
          />
          <button
            type="button"
            onClick={() => void updateMode(settings.mode, settings.pointerPolicy === 'draw' ? 'pass-through' : 'draw')}
            aria-pressed={settings.pointerPolicy === 'pass-through'}
            title={english ? 'Toggle click-through' : '切换点击穿透'}
            style={compactButton(settings.pointerPolicy === 'pass-through')}
          >
            <I.Hand size={15} />
          </button>
        </div>
      )}
      <button
        type="button"
        data-testid="desktop-ink-launcher"
        aria-label={english ? 'Open desktop whiteboard' : '打开桌面白板'}
        aria-pressed={settings.visible && settings.pointerPolicy === 'draw'}
        onClick={() => void updateMode(settings.visible ? settings.mode : 'full-board', 'draw')}
        className="grid place-items-center"
        style={{
          ...compactButton(settings.visible), width: 34, height: 34,
          background: settings.visible ? 'var(--hi)' : 'var(--paper)',
        }}
      >
        <I.Pencil size={16} />
      </button>
    </div>
  );
}

function ModeButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return <button type="button" aria-pressed={active} onClick={onClick} style={compactButton(active)}>{children}</button>;
}

function OpacityControl({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-[9px]">
      <span>{label}</span>
      <input
        aria-label={label}
        type="range" min={0} max={100} step={1}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        style={{ width: 72, accentColor: 'var(--hi)' }}
      />
    </label>
  );
}

function compactButton(active: boolean): CSSProperties {
  return {
    minHeight: 26, padding: '4px 7px', border: '1px solid var(--ink)', borderRadius: 3,
    color: 'var(--ink)', background: active ? 'var(--hi)' : 'transparent',
    cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 650,
  };
}

function isRuntimeState(value: unknown): value is DesktopInkRuntimeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<DesktopInkRuntimeState>;
  return typeof state.visible === 'boolean'
    && (state.mode === 'ink' || state.mode === 'full-board')
    && (state.pointerPolicy === 'draw' || state.pointerPolicy === 'pass-through')
    && typeof state.backgroundOpacity === 'number'
    && typeof state.inkOpacity === 'number';
}
