'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';
import type { RecordingSetupConfig } from '@/types/recording';

type NativePermissionState = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
type ReadinessState = NativePermissionState | 'unsupported' | 'missing' | 'probe-error';

interface CapturePermissions {
  screen: NativePermissionState;
  microphone: NativePermissionState;
  camera: NativePermissionState;
  inputMonitoring: NativePermissionState;
}

interface CaptureDevices {
  microphones: string[];
  cameras: string[];
}

export interface DesktopCaptureReadiness {
  blocked: boolean;
  reason?: 'permissions' | 'devices' | 'probe';
}

const UNKNOWN_PERMISSIONS: CapturePermissions = {
  screen: 'unknown',
  microphone: 'unknown',
  camera: 'unknown',
  inputMonitoring: 'unknown',
};

function parsePermissions(value: unknown): CapturePermissions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const read = (key: keyof CapturePermissions): NativePermissionState => (
    ['granted', 'denied', 'restricted', 'not-determined'].includes(source[key] as string)
      ? source[key] as NativePermissionState
      : 'unknown'
  );
  const parsed = {
    screen: read('screen'),
    microphone: read('microphone'),
    camera: read('camera'),
    inputMonitoring: read('inputMonitoring'),
  };
  return Object.values(parsed).some((state) => state === 'unknown') ? null : parsed;
}

function parseDevices(value: unknown): CaptureDevices | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.microphones) || !Array.isArray(source.cameras)) return null;
  const names = (devices: unknown[]): string[] | null => {
    const parsed: string[] = [];
    for (const device of devices) {
      if (!device || typeof device !== 'object' || Array.isArray(device)) return null;
      const name = (device as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) return null;
      parsed.push(name);
    }
    return parsed;
  };
  const microphones = names(source.microphones);
  const cameras = names(source.cameras);
  return microphones && cameras ? { microphones, cameras } : null;
}

export function DesktopTeachingCaptureConsole({
  config,
  onReadinessChange,
}: {
  config: RecordingSetupConfig;
  onReadinessChange?: (readiness: DesktopCaptureReadiness) => void;
}): JSX.Element | null {
  const t = useTranslations('recordingSetup.desktopStudio');
  const [permissions, setPermissions] = useState<CapturePermissions>(UNKNOWN_PERMISSIONS);
  const [devices, setDevices] = useState<CaptureDevices>({ microphones: [], cameras: [] });
  const [permissionProbeFailed, setPermissionProbeFailed] = useState(false);
  const [deviceProbeFailed, setDeviceProbeFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(false);
  const probeRevisionRef = useRef(0);
  const bridge = typeof window === 'undefined' ? undefined : window.excalicastDesktop;
  const nativeCapture = Boolean(bridge)
    && (config.source?.kind === 'desktop' || config.source?.kind === 'window');

  const probe = useCallback(async (requestPermissions: boolean) => {
    if (!bridge || !nativeCapture) return;
    const revision = ++probeRevisionRef.current;
    setChecking(true);
    const permissionCall = requestPermissions
      ? bridge.invoke(DESKTOP_IPC_CHANNELS.captureRequestPermissions, {
          captureMicrophone: true,
          captureCamera: config.camera.enabled,
        })
      : bridge.invoke(DESKTOP_IPC_CHANNELS.capturePermissions);
    const [permissionResult, deviceResult] = await Promise.allSettled([
      permissionCall,
      bridge.invoke(DESKTOP_IPC_CHANNELS.captureDevices),
    ]);
    if (!mountedRef.current || revision !== probeRevisionRef.current) return;
    if (permissionResult.status === 'fulfilled') {
      const parsed = parsePermissions(permissionResult.value);
      if (parsed) {
        setPermissions(parsed);
        setPermissionProbeFailed(false);
      } else {
        setPermissionProbeFailed(true);
      }
    } else {
      setPermissionProbeFailed(true);
    }
    if (deviceResult.status === 'fulfilled') {
      const parsed = parseDevices(deviceResult.value);
      if (parsed) {
        setDevices(parsed);
        setDeviceProbeFailed(false);
      } else {
        setDeviceProbeFailed(true);
      }
    } else {
      setDeviceProbeFailed(true);
    }
    setChecking(false);
  }, [bridge, config.camera.enabled, nativeCapture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      probeRevisionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!nativeCapture) {
      probeRevisionRef.current += 1;
      setChecking(false);
      return;
    }
    void probe(false);
  }, [probe]);

  const selectedAssets = config.teachingRecipe?.enabled
    ? config.teachingRecipe.selectedAssetIds.length
    : 0;
  const rows = useMemo(() => [
    { id: 'screen', label: t('screen'), state: permissionProbeFailed ? 'probe-error' as const : permissions.screen, detail: undefined },
    { id: 'input', label: t('inputMonitoring'), state: permissionProbeFailed ? 'probe-error' as const : permissions.inputMonitoring, detail: undefined },
    {
      id: 'microphone', label: t('microphone'),
      state: permissionProbeFailed || deviceProbeFailed
        ? 'probe-error' as const
        : permissions.microphone === 'granted' && devices.microphones.length === 0
        ? 'missing' as const
        : permissions.microphone,
      detail: permissions.microphone === 'granted' && devices.microphones.length > 0
        ? devices.microphones[0]
        : undefined,
    },
    {
      id: 'camera', label: t('camera'),
      state: !config.camera.enabled
        ? 'unsupported' as const
        : permissionProbeFailed || deviceProbeFailed
          ? 'probe-error' as const
        : permissions.camera === 'granted' && devices.cameras.length === 0
          ? 'missing' as const
          : permissions.camera,
      detail: config.camera.enabled && permissions.camera === 'granted' && devices.cameras.length > 0
        ? devices.cameras[0]
        : !config.camera.enabled ? t('notSelected') : undefined,
    },
    {
      id: 'system-audio', label: t('systemAudio'),
      state: config.source?.kind === 'whiteboard' || !config.source?.captureSystemAudio
        ? 'unsupported' as const
        : 'unknown' as const,
      detail: config.source?.captureSystemAudio ? t('verifiedOnStart') : t('notSelected'),
    },
    { id: 'encoder', label: t('encoder'), state: 'unknown' as const, detail: t('verifiedOnStart') },
  ], [config.camera.enabled, config.source, deviceProbeFailed, devices.cameras, devices.microphones, permissionProbeFailed, permissions, t]);

  const readiness = useMemo<DesktopCaptureReadiness>(() => {
    if (!nativeCapture) return { blocked: false };
    if (checking || permissionProbeFailed || deviceProbeFailed) return { blocked: true, reason: 'probe' };
    if (permissions.screen !== 'granted'
      || permissions.inputMonitoring !== 'granted'
      || permissions.microphone !== 'granted'
      || (config.camera.enabled && permissions.camera !== 'granted')) {
      return { blocked: true, reason: 'permissions' };
    }
    if (devices.microphones.length === 0 || (config.camera.enabled && devices.cameras.length === 0)) {
      return { blocked: true, reason: 'devices' };
    }
    return { blocked: false };
  }, [checking, config.camera.enabled, deviceProbeFailed, devices.cameras.length, devices.microphones.length, nativeCapture, permissionProbeFailed, permissions]);

  useEffect(() => { onReadinessChange?.(readiness); }, [onReadinessChange, readiness]);

  if (!nativeCapture) return null;
  const hasRequestablePermission = permissions.screen === 'not-determined'
    || permissions.microphone === 'not-determined'
    || (config.camera.enabled && permissions.camera === 'not-determined');
  const deniedPermissionPaths = ([
    ['screen', permissions.screen],
    ['microphone', permissions.microphone],
    ...(config.camera.enabled ? [['camera', permissions.camera] as const] : []),
    ['inputMonitoring', permissions.inputMonitoring],
  ] as const)
    .filter(([, state]) => state === 'denied' || state === 'restricted')
    .map(([permission]) => t(`permissionPaths.${permission}`));
  return (
    <section
      className="desktop-studio-console"
      data-testid="desktop-teaching-capture-console"
      aria-labelledby="desktop-studio-console-title"
    >
      <header className="desktop-studio-console__header">
        <div>
          <p className="desktop-studio-console__eyebrow">{t('eyebrow')}</p>
          <h3 id="desktop-studio-console-title">{t('title')}</h3>
        </div>
        <span className="desktop-studio-console__recipe">
          {config.teachingRecipe?.enabled ? t('assetsSelected', { count: selectedAssets }) : t('autoFilmOff')}
        </span>
      </header>
      <p className="desktop-studio-console__summary">
        {t('summary', {
          source: t(`sources.${config.source?.kind ?? 'whiteboard'}`),
          camera: config.camera.enabled ? t('cameraOn') : t('cameraOff'),
        })}
      </p>
      <ul className="desktop-studio-readiness" aria-label={t('readiness')}>
        {rows.map((row) => (
          <li key={row.id} className="desktop-studio-readiness__item" data-state={row.state}>
            <span className="desktop-studio-readiness__mark" aria-hidden="true" />
            <span className="desktop-studio-readiness__copy">
              <strong>{row.label}</strong>
              {row.detail && <small>{row.detail}</small>}
            </span>
            <span className="desktop-studio-readiness__state">{statusLabel(row.state, t)}</span>
          </li>
        ))}
      </ul>
      <div className="desktop-studio-console__actions">
        <p>{t('permissionHelp')}</p>
        {deniedPermissionPaths.length > 0 && (
          <ul data-testid="desktop-permission-recovery-paths">
            {deniedPermissionPaths.map((path) => <li key={path}>{path}</li>)}
          </ul>
        )}
        <button
          type="button"
          onClick={() => { void probe(hasRequestablePermission); }}
          disabled={checking}
        >
          {checking
            ? t('checking')
            : hasRequestablePermission
              ? t('requestAndRetryReadiness')
              : t('retryReadiness')}
        </button>
      </div>
    </section>
  );
}

function statusLabel(
  state: ReadinessState,
  t: ReturnType<typeof useTranslations<'recordingSetup.desktopStudio'>>,
): string {
  if (state === 'granted') return t('granted');
  if (state === 'denied' || state === 'restricted') return t('attention');
  if (state === 'missing') return t('noDevice');
  if (state === 'probe-error') return t('probeFailed');
  if (state === 'unsupported') return t('notSelected');
  return t('unknown');
}
