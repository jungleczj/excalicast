import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

export interface HelperTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  close(): void;
}

interface HelperResponse {
  id: string;
  ok: boolean;
  protocolVersion?: number;
  engine?: string;
  state?: 'idle' | 'recording' | 'paused' | 'stopping';
  capability?: NativeCaptureCapability;
  sources?: NativeCaptureSources;
  devices?: NativeCaptureDevices;
  permissions?: NativeCapturePermissions;
  pressure?: NativeCapturePressure;
  manifest?: NativeRecordingManifest;
  validation?: NativeRecordingValidationReport;
  materializedTrack?: NativeMaterializedTrack;
  muted?: boolean;
  hidden?: boolean;
  hardwareState?: 'active' | 'off';
  physicallyPowered?: boolean;
  telemetryAck?: NativeInputTelemetryAcknowledgement;
  finalRender?: unknown;
  error?: string;
  errorCode?: string;
  errorTrack?: NativeRecordingTrack;
}

export type NativeRecordingTrack =
  | 'screen'
  | 'camera'
  | 'microphone'
  | 'system-audio'
  | 'excalidraw-events'
  | 'input-telemetry';

export type NativeReadableMediaTrack = Extract<NativeRecordingTrack,
  'screen' | 'camera' | 'microphone' | 'system-audio'>;

export interface NativeMaterializedTrack {
  track: NativeReadableMediaTrack;
  relativePath: string;
  byteLength: number;
  mimeType: 'video/mp4' | 'audio/mp4';
}

export class NativeHelperError extends Error {
  readonly name = 'NativeHelperError';

  constructor(
    message: string,
    readonly code: string,
    readonly track?: NativeRecordingTrack,
  ) {
    super(message);
  }
}

export interface NativeCaptureRequest {
  recordingId: string;
  projectRoot: string;
  sourceKind: 'display' | 'window';
  sourceID: number;
  width: number;
  height: number;
  framesPerSecond: number;
  codec: 'h264' | 'hevc';
  captureSystemAudio?: boolean;
  captureMicrophone?: boolean;
  microphoneDeviceID?: string;
  captureCamera?: boolean;
  cameraDeviceID?: string;
  cameraWidth?: number;
  cameraHeight?: number;
  cameraFramesPerSecond?: number;
  /** Native desktop windows that must never be baked into display capture. */
  excludedWindowIDs?: number[];
}

export interface NativeCaptureConfiguration {
  width: number;
  height: number;
  framesPerSecond: number;
  codec: 'h264' | 'hevc';
}

export interface NativeCaptureCapability {
  requested: NativeCaptureConfiguration;
  effective: NativeCaptureConfiguration;
  hardwareEncodingConfirmed: boolean;
  availableBytes: number;
}

export interface NativeCaptureResult {
  state: 'idle' | 'recording' | 'stopping';
  capability: NativeCaptureCapability;
}

export interface NativeFinalRenderJobRequest {
  requestID: string;
  requestSHA256: string;
}

export type NativeFinalRenderJobStatus =
  | { state: 'idle' }
  | (NativeFinalRenderJobRequest & { state: 'rendering' | 'cancelled' })
  | (NativeFinalRenderJobRequest & { state: 'ready'; outputIdentity: string })
  | (NativeFinalRenderJobRequest & { state: 'failed'; errorCode: string });

export interface NativeInkEventBatch {
  index: number;
  startUs: number;
  durationUs: number;
  payload: string;
}

export interface NativeInputTelemetryProducerBatch {
  payload: string;
}

export interface NativeInputTelemetryAcknowledgement {
  producerId: 'main-whiteboard' | 'desktop-ink';
  producerEpoch: string;
  acknowledgedSequence: number;
  segmentIndex: number | null;
  duplicate: boolean;
  dropped: boolean;
}

export interface NativeCaptureSources {
  displays: Array<{ displayID: number; width: number; height: number }>;
  windows: Array<{
    windowID: number;
    title: string;
    applicationName: string;
    width: number;
    height: number;
  }>;
}

export interface NativeCapturePermissions {
  screen: 'granted' | 'denied' | 'restricted' | 'not-determined';
  microphone: 'granted' | 'denied' | 'restricted' | 'not-determined';
  camera: 'granted' | 'denied' | 'restricted' | 'not-determined';
  inputMonitoring: 'granted' | 'denied' | 'restricted' | 'not-determined';
}

export interface NativeCaptureDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NativeCaptureDevices {
  microphones: NativeCaptureDevice[];
  cameras: NativeCaptureDevice[];
}

export interface NativeCapturePressure {
  receivedScreenSamples: number;
  submittedVideoFrames: number;
  encodedVideoFrames: number;
  droppedPendingFrames: number;
  pendingEncoderFrames: number;
  completeSamples: number;
  idleSamples: number;
  blankSamples: number;
  suspendedSamples: number;
  pixelBufferSamples: number;
  availableDiskBytes: number;
  diskPressure: 'normal' | 'warning' | 'critical';
  pendingWriteBytes: number;
  committedBytes: number;
  lastSegmentWriteLatencyMs: number;
  maximumSegmentWriteLatencyMs: number;
}

export interface NativeRecordingSegment {
  index: number;
  relativePath: string;
  startUs: number;
  durationUs: number;
  byteLength: number;
}

export interface NativeRecordingManifest {
  schemaVersion: 1;
  recordingId: string;
  state: 'recording' | 'finalizing' | 'ready' | 'interrupted' | 'error';
  tracks: Record<string, NativeRecordingSegment[]>;
  capture?: {
    screen: NativeCaptureConfiguration;
    camera?: NativeCaptureConfiguration;
    capturesSystemAudio: boolean;
    capturesMicrophone: boolean;
    hardwareEncodingConfirmed: boolean;
    initialAvailableBytes: number;
    finalPressure?: NativeCapturePressure;
  };
}

export interface NativeContinuityIssue {
  code: 'missing-required-track' | 'invalid-segment-metadata' | 'non-contiguous-index'
    | 'non-monotonic-timeline' | 'gap' | 'overlap';
  segmentIndex?: number;
  deltaUs?: number;
}

export interface NativeTrackContinuityReport {
  track: NativeRecordingTrack;
  segmentCount: number;
  firstStartUs?: number;
  endUs?: number;
  maximumGapUs: number;
  maximumOverlapUs: number;
  issues: NativeContinuityIssue[];
}

export interface NativeRecordingValidationReport {
  isValid: boolean;
  manifestState: NativeRecordingManifest['state'];
  continuity: {
    isValid: boolean;
    requiredTracks: NativeRecordingTrack[];
    tracks: Partial<Record<NativeRecordingTrack, NativeTrackContinuityReport>>;
  };
  segments: Array<{
    track: NativeRecordingTrack;
    index: number;
    relativePath: string;
    expectedCodec: string;
    actualCodec?: string;
    durationUs: number;
    byteLength: number;
    isDecodable: boolean;
    issue?: string | null;
  }>;
}

export interface NativeHelperHandshake {
  protocolVersion: 1;
  engine: 'mac-media-engine';
  state: 'idle' | 'recording' | 'paused' | 'stopping';
}

export class NativeHelperClient {
  private readonly pending = new Map<string, {
    resolve: (response: HelperResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly transport: HelperTransport,
    readonly processId?: number,
  ) {
    transport.onLine((line) => this.receive(line));
  }

  async handshake(): Promise<NativeHelperHandshake> {
    const response = await this.request({ channel: 'helper.handshake.v1', protocolVersion: 1 });
    if (response.protocolVersion !== 1 || response.engine !== 'mac-media-engine' || !response.state) {
      throw new Error('native_helper_protocol_mismatch');
    }
    return {
      protocolVersion: response.protocolVersion,
      engine: response.engine,
      state: response.state,
    };
  }

  async preflightCapture(request: NativeCaptureRequest): Promise<NativeCaptureCapability> {
    const response = await this.request({ channel: 'capture.preflight.v1', ...request }, 10_000);
    if (!response.capability) throw new Error('native_capture_capability_missing');
    return response.capability;
  }

  async captureSources(): Promise<NativeCaptureSources> {
    const response = await this.request({ channel: 'capture.sources.v1' });
    if (!response.sources) throw new Error('native_capture_sources_missing');
    return response.sources;
  }

  async captureDevices(): Promise<NativeCaptureDevices> {
    const response = await this.request({ channel: 'capture.devices.v1' });
    if (!response.devices) throw new Error('native_capture_devices_missing');
    return response.devices;
  }

  async capturePermissions(): Promise<NativeCapturePermissions> {
    const response = await this.request({ channel: 'capture.permissions.v1' });
    if (!response.permissions) throw new Error('native_capture_permissions_missing');
    return response.permissions;
  }

  async requestCapturePermissions(options: {
    captureMicrophone: boolean;
    captureCamera: boolean;
  }): Promise<NativeCapturePermissions> {
    const response = await this.request(
      { channel: 'capture.request-permissions.v1', ...options },
      120_000,
    );
    if (!response.permissions) throw new Error('native_capture_permissions_missing');
    return response.permissions;
  }

  async startCapture(request: NativeCaptureRequest): Promise<NativeCaptureResult> {
    const response = await this.request({ channel: 'capture.start.v1', ...request }, 30_000);
    if (response.state !== 'recording' || !response.capability) {
      throw new Error('native_capture_start_invalid');
    }
    return { state: response.state, capability: response.capability };
  }

  async startFinalRender(
    request: NativeFinalRenderJobRequest,
  ): Promise<NativeFinalRenderJobStatus> {
    const response = await this.request({
      channel: 'final-render.start.v1',
      requestID: request.requestID,
      requestSHA256: request.requestSHA256,
    });
    return requireFinalRenderStatus(response.finalRender);
  }

  async finalRenderStatus(): Promise<NativeFinalRenderJobStatus> {
    const response = await this.request({ channel: 'final-render.status.v1' });
    return requireFinalRenderStatus(response.finalRender);
  }

  async cancelFinalRender(
    request: NativeFinalRenderJobRequest,
  ): Promise<NativeFinalRenderJobStatus> {
    const response = await this.request(
      {
        channel: 'final-render.cancel.v1',
        requestID: request.requestID,
        requestSHA256: request.requestSHA256,
      },
      30_000,
    );
    return requireFinalRenderStatus(response.finalRender);
  }

  async stopCapture(): Promise<'idle'> {
    const response = await this.request({ channel: 'capture.stop.v1' });
    if (response.state !== 'idle') throw new Error('native_capture_stop_invalid');
    return response.state;
  }

  async pauseCapture(): Promise<'paused'> {
    const response = await this.request({ channel: 'capture.pause.v1' });
    if (response.state !== 'paused') throw new Error('native_capture_pause_invalid');
    return response.state;
  }

  async resumeCapture(): Promise<'recording'> {
    const response = await this.request({ channel: 'capture.resume.v1' });
    if (response.state !== 'recording') throw new Error('native_capture_resume_invalid');
    return response.state;
  }

  async setMicrophoneMuted(muted: boolean): Promise<boolean> {
    const response = await this.request({ channel: 'capture.microphone-muted.v1', muted });
    if (response.muted !== muted) throw new Error('native_microphone_mute_invalid');
    return response.muted;
  }

  async setSystemAudioMuted(muted: boolean): Promise<boolean> {
    const response = await this.request({ channel: 'capture.system-audio-muted.v1', muted });
    if (response.muted !== muted) throw new Error('native_system_audio_mute_invalid');
    return response.muted;
  }

  async setCameraVisibility(hidden: boolean): Promise<boolean> {
    const response = await this.request({ channel: 'capture.camera-visibility.v1', hidden });
    if (response.hidden !== hidden) throw new Error('native_camera_visibility_invalid');
    return response.hidden;
  }

  async setCameraHardwareEnabled(enabled: boolean): Promise<{
    hardwareState: 'active' | 'off';
    physicallyPowered: boolean;
  }> {
    const response = await this.request({ channel: 'capture.camera-hardware.v1', enabled });
    const expected = enabled ? 'active' : 'off';
    if (response.hardwareState !== expected || response.physicallyPowered !== enabled) {
      throw new Error('native_camera_hardware_state_invalid');
    }
    return { hardwareState: response.hardwareState, physicallyPowered: response.physicallyPowered };
  }

  async captureStatus(): Promise<{
    state: 'idle' | 'recording' | 'paused' | 'stopping';
    pressure?: NativeCapturePressure;
    error?: string;
    errorCode?: string;
    errorTrack?: NativeRecordingTrack;
  }> {
    const response = await this.request({ channel: 'capture.status.v1' });
    if (!response.state) throw new Error('native_capture_status_missing');
    return {
      state: response.state,
      pressure: response.pressure,
      error: response.error,
      errorCode: response.errorCode,
      errorTrack: response.errorTrack,
    };
  }

  async recoverProject(projectRoot: string): Promise<NativeRecordingManifest> {
    const response = await this.request({ channel: 'project.recover.v1', projectRoot }, 15_000);
    if (!response.manifest) throw new Error('native_recording_manifest_missing');
    return response.manifest;
  }

  async validateProject(projectRoot: string): Promise<NativeRecordingValidationReport> {
    const response = await this.request({ channel: 'project.validate.v1', projectRoot }, 30_000);
    if (!response.validation) throw new Error('native_recording_validation_missing');
    return response.validation;
  }

  async materializeProjectTrack(
    projectRoot: string,
    mediaTrack: NativeReadableMediaTrack,
  ): Promise<NativeMaterializedTrack> {
    const response = await this.request({
      channel: 'project.materialize-track.v1',
      projectRoot,
      mediaTrack,
    }, 120_000);
    if (!response.materializedTrack) throw new Error('native_materialized_track_missing');
    return response.materializedTrack;
  }

  async appendInkEvents(batch: NativeInkEventBatch): Promise<void> {
    const response = await this.request({
      channel: 'ink.append-events.v1',
      eventIndex: batch.index,
      eventStartUs: batch.startUs,
      eventDurationUs: batch.durationUs,
      eventPayload: batch.payload,
    }, 15_000);
    if (response.state !== 'recording') throw new Error('native_ink_event_append_invalid');
  }

  async appendInputTelemetry(
    batch: NativeInputTelemetryProducerBatch,
  ): Promise<NativeInputTelemetryAcknowledgement> {
    const response = await this.request({
      channel: 'input-telemetry.append-producer-events.v1',
      telemetryProducerPayload: batch.payload,
    }, 15_000);
    if ((response.state !== 'recording' && response.state !== 'paused') || !response.telemetryAck) {
      throw new Error('native_input_telemetry_append_invalid');
    }
    return response.telemetryAck;
  }

  close(): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error('native_helper_closed'));
    }
    this.pending.clear();
    this.transport.close();
  }

  private request(
    command: Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<HelperResponse> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('native_helper_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.transport.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  private receive(line: string): void {
    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch {
      return;
    }
    const item = this.pending.get(response.id);
    if (!item) return;
    clearTimeout(item.timeout);
    this.pending.delete(response.id);
    if (response.ok) item.resolve(response);
    else item.reject(new NativeHelperError(
      response.error ?? 'native_helper_request_failed',
      response.errorCode ?? 'native_helper_request_failed',
      response.errorTrack,
    ));
  }
}

function requireFinalRenderStatus(
  value: unknown,
): NativeFinalRenderJobStatus {
  if (!isRecord(value) || typeof value.state !== 'string') {
    throw new Error('native_final_render_status_invalid');
  }
  if (value.state === 'idle') {
    if (!hasExactKeys(value, ['state'])) throw new Error('native_final_render_status_invalid');
    return { state: 'idle' };
  }
  if (!validFinalRenderRequestIdentity(value)) {
    throw new Error('native_final_render_status_invalid');
  }
  if (value.state === 'ready') {
    if (!hasExactKeys(value, ['state', 'requestID', 'requestSHA256', 'outputIdentity'])
      || typeof value.outputIdentity !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.outputIdentity)) {
      throw new Error('native_final_render_status_invalid');
    }
    return {
      state: value.state,
      requestID: value.requestID,
      requestSHA256: value.requestSHA256,
      outputIdentity: value.outputIdentity,
    };
  }
  if (value.state === 'failed') {
    if (!hasExactKeys(value, ['state', 'requestID', 'requestSHA256', 'errorCode'])
      || typeof value.errorCode !== 'string'
      || !/^[a-z0-9._-]{1,128}$/.test(value.errorCode)) {
      throw new Error('native_final_render_status_invalid');
    }
    return {
      state: value.state,
      requestID: value.requestID,
      requestSHA256: value.requestSHA256,
      errorCode: value.errorCode,
    };
  }
  if (value.state === 'rendering' || value.state === 'cancelled') {
    if (!hasExactKeys(value, ['state', 'requestID', 'requestSHA256'])) {
      throw new Error('native_final_render_status_invalid');
    }
    return {
      state: value.state,
      requestID: value.requestID,
      requestSHA256: value.requestSHA256,
    };
  }
  throw new Error('native_final_render_status_invalid');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function validFinalRenderRequestIdentity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & NativeFinalRenderJobRequest {
  return typeof value.requestID === 'string'
    && typeof value.requestSHA256 === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.requestID)
    && /^[a-f0-9]{64}$/.test(value.requestSHA256);
}

export function spawnNativeHelper(executablePath: string): NativeHelperClient {
  const child: ChildProcessWithoutNullStreams = spawn(executablePath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const transport: HelperTransport = {
    write(line) { child.stdin.write(line); },
    onLine(listener) { lines.on('line', listener); },
    close() {
      lines.close();
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
    },
  };
  return new NativeHelperClient(transport, child.pid);
}
