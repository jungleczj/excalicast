import { startDesktopCaptureWithResourcePriority } from './captureResourceGate';
import { DESKTOP_IPC_CHANNELS } from './productContract';

export interface DesktopCaptureBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export interface DesktopAiCameraSource {
  kind: 'display' | 'window';
  id: number;
  width: number;
  height: number;
}

export interface DesktopAiCameraSessionInput {
  bridge: DesktopCaptureBridge;
  recordingId: string;
  source: DesktopAiCameraSource;
  captureSystemAudio: boolean;
  captureMicrophone: boolean;
  microphoneDeviceID?: string;
  camera: {
    enabled: boolean;
    deviceID?: string;
    width?: number;
    height?: number;
    framesPerSecond?: number;
  };
  screenFramesPerSecond?: number;
}

export interface DesktopAiCameraSession {
  recordingId: string;
  readonly state: 'recording' | 'paused';
  cameraDeviceID?: string;
  microphoneDeviceID?: string;
  getElapsedMs(): number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;
  setSystemAudioMuted(muted: boolean): Promise<void>;
  setCameraHidden(hidden: boolean): Promise<void>;
  setCameraHardwareEnabled(enabled: boolean): Promise<{
    hardwareState: 'active' | 'off';
    physicallyPowered: boolean;
  }>;
  stop(): Promise<void>;
}

interface CapturePermissions {
  screen: PermissionState;
  microphone: PermissionState;
  camera: PermissionState;
}

interface CaptureDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

interface CaptureDevices {
  microphones: CaptureDevice[];
  cameras: CaptureDevice[];
}

function asPermissions(value: unknown): CapturePermissions {
  if (!value || typeof value !== 'object') throw new Error('desktop_capture_permissions_invalid');
  return value as CapturePermissions;
}

function asDevices(value: unknown): CaptureDevices {
  if (!value || typeof value !== 'object') throw new Error('desktop_capture_devices_invalid');
  const devices = value as CaptureDevices;
  if (!Array.isArray(devices.microphones) || !Array.isArray(devices.cameras)) {
    throw new Error('desktop_capture_devices_invalid');
  }
  return devices;
}

function preferredDevice(devices: CaptureDevice[], requested?: string): string | undefined {
  if (requested) {
    if (!devices.some((device) => device.id === requested)) {
      throw new Error('desktop_capture_device_not_found');
    }
    return requested;
  }
  return devices.find((device) => device.isDefault)?.id ?? devices[0]?.id;
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function screenSize(source: DesktopAiCameraSource): { width: number; height: number } {
  const scale = Math.min(1, 2560 / source.width, 1440 / source.height);
  return {
    width: even(source.width * scale),
    height: even(source.height * scale),
  };
}

/**
 * Starts the macOS-native teaching capture as one atomic media session.
 * Camera, screen, system audio and microphone share the native session clock;
 * the notch teleprompter remains an independent, capture-excluded subscriber.
 */
export async function startDesktopAiCameraSession(
  input: DesktopAiCameraSessionInput,
): Promise<DesktopAiCameraSession> {
  let permissions = asPermissions(await input.bridge.invoke(DESKTOP_IPC_CHANNELS.capturePermissions));
  const needsPermission = permissions.screen !== 'granted'
    || (input.captureMicrophone && permissions.microphone !== 'granted')
    || (input.camera.enabled && permissions.camera !== 'granted');
  if (needsPermission) {
    permissions = asPermissions(await input.bridge.invoke(
      DESKTOP_IPC_CHANNELS.captureRequestPermissions,
      { captureMicrophone: input.captureMicrophone, captureCamera: input.camera.enabled },
    ));
  }
  if (permissions.screen !== 'granted'
    || (input.captureMicrophone && permissions.microphone !== 'granted')
    || (input.camera.enabled && permissions.camera !== 'granted')) {
    throw new Error('desktop_capture_permission_required');
  }

  const devices = asDevices(await input.bridge.invoke(DESKTOP_IPC_CHANNELS.captureDevices));
  const microphoneDeviceID = input.captureMicrophone
    ? preferredDevice(devices.microphones, input.microphoneDeviceID)
    : undefined;
  const cameraDeviceID = input.camera.enabled
    ? preferredDevice(devices.cameras, input.camera.deviceID)
    : undefined;
  if (input.captureMicrophone && !microphoneDeviceID) throw new Error('desktop_microphone_not_found');
  if (input.camera.enabled && !cameraDeviceID) throw new Error('desktop_camera_not_found');

  const size = screenSize(input.source);
  const request = {
    recordingId: input.recordingId,
    sourceKind: input.source.kind,
    sourceID: input.source.id,
    width: size.width,
    height: size.height,
    framesPerSecond: input.screenFramesPerSecond ?? 30,
    codec: 'h264' as const,
    captureSystemAudio: input.captureSystemAudio,
    captureMicrophone: input.captureMicrophone,
    ...(microphoneDeviceID ? { microphoneDeviceID } : {}),
    captureCamera: input.camera.enabled,
    ...(cameraDeviceID ? { cameraDeviceID } : {}),
    ...(input.camera.enabled ? {
      cameraWidth: input.camera.width ?? 1280,
      cameraHeight: input.camera.height ?? 720,
      cameraFramesPerSecond: input.camera.framesPerSecond ?? 24,
    } : {}),
  };
  const capability = await input.bridge.invoke(DESKTOP_IPC_CHANNELS.capturePreflight, request);
  if (!capability || typeof capability !== 'object'
    || (capability as { hardwareEncodingConfirmed?: unknown }).hardwareEncodingConfirmed !== true) {
    throw new Error('desktop_hardware_encoder_unavailable');
  }
  const started = await startDesktopCaptureWithResourcePriority<{ state?: unknown }>(request, {
    invoke: (channel, payload) => input.bridge.invoke(channel, payload) as Promise<{ state?: unknown }>,
  });
  if (started.state !== 'recording') throw new Error('desktop_capture_start_invalid');

  let stopped = false;
  let stopAttempt: Promise<void> | null = null;
  let sessionState: DesktopAiCameraSession['state'] = 'recording';
  const startedAt = Date.now();
  let pauseStartedAt = 0;
  let pausedTotalMs = 0;
  let stoppedElapsedMs: number | null = null;
  let controlTail = Promise.resolve();
  const currentElapsedMs = () => Math.max(0, Date.now() - startedAt - pausedTotalMs
    - (sessionState === 'paused' ? Date.now() - pauseStartedAt : 0));
  const control = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = controlTail.then(operation, operation);
    controlTail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  return {
    recordingId: input.recordingId,
    get state() { return sessionState; },
    cameraDeviceID,
    microphoneDeviceID,
    getElapsedMs() {
      return stoppedElapsedMs ?? currentElapsedMs();
    },
    pause() {
      return control(async () => {
        if (sessionState === 'paused') return;
        const response = await input.bridge.invoke(DESKTOP_IPC_CHANNELS.capturePause) as { state?: unknown };
        if (response?.state !== 'paused') throw new Error('desktop_capture_pause_invalid');
        sessionState = 'paused';
        pauseStartedAt = Date.now();
      });
    },
    resume() {
      return control(async () => {
        if (sessionState === 'recording') return;
        const response = await input.bridge.invoke(DESKTOP_IPC_CHANNELS.captureResume) as { state?: unknown };
        if (response?.state !== 'recording') throw new Error('desktop_capture_resume_invalid');
        pausedTotalMs += Date.now() - pauseStartedAt;
        pauseStartedAt = 0;
        sessionState = 'recording';
      });
    },
    setMicrophoneMuted(muted) {
      return control(async () => {
        const response = await input.bridge.invoke(
          DESKTOP_IPC_CHANNELS.captureSetMicrophoneMuted,
          { muted },
        ) as { muted?: unknown };
        if (response?.muted !== muted) throw new Error('desktop_microphone_mute_invalid');
      });
    },
    setSystemAudioMuted(muted) {
      return control(async () => {
        const response = await input.bridge.invoke(
          DESKTOP_IPC_CHANNELS.captureSetSystemAudioMuted,
          { muted },
        ) as { muted?: unknown };
        if (response?.muted !== muted) throw new Error('desktop_system_audio_mute_invalid');
      });
    },
    setCameraHidden(hidden) {
      return control(async () => {
        const response = await input.bridge.invoke(
          DESKTOP_IPC_CHANNELS.captureSetCameraVisibility,
          { hidden },
        ) as { hidden?: unknown };
        if (response?.hidden !== hidden) throw new Error('desktop_camera_visibility_invalid');
      });
    },
    setCameraHardwareEnabled(enabled) {
      return control(async () => {
        const response = await input.bridge.invoke(
          DESKTOP_IPC_CHANNELS.captureSetCameraHardware,
          { enabled },
        ) as { hardwareState?: unknown; physicallyPowered?: unknown };
        const expected = enabled ? 'active' : 'off';
        if (response?.hardwareState !== expected || response.physicallyPowered !== enabled) {
          throw new Error('desktop_camera_hardware_state_invalid');
        }
        return { hardwareState: expected, physicallyPowered: enabled };
      });
    },
    async stop() {
      if (stopped) return;
      await controlTail;
      if (!stopAttempt) {
        stoppedElapsedMs = currentElapsedMs();
        stopAttempt = input.bridge.invoke(DESKTOP_IPC_CHANNELS.captureStop)
          .then(() => { stopped = true; })
          .catch((error) => {
            stoppedElapsedMs = null;
            throw error;
          })
          .finally(() => { stopAttempt = null; });
      }
      await stopAttempt;
    },
  };
}
