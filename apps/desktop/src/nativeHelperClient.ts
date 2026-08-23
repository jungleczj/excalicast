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
  state?: 'idle' | 'recording' | 'stopping';
  capability?: NativeCaptureCapability;
  sources?: NativeCaptureSources;
  error?: string;
}

export interface NativeCaptureRequest {
  recordingId: string;
  projectRoot: string;
  displayID: number;
  width: number;
  height: number;
  framesPerSecond: number;
  codec: 'h264' | 'hevc';
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

export interface NativeHelperHandshake {
  protocolVersion: 1;
  engine: 'mac-media-engine';
  state: 'idle' | 'recording' | 'stopping';
}

export class NativeHelperClient {
  private readonly pending = new Map<string, {
    resolve: (response: HelperResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly transport: HelperTransport) {
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
    const response = await this.request({ channel: 'capture.preflight.v1', ...request });
    if (!response.capability) throw new Error('native_capture_capability_missing');
    return response.capability;
  }

  async captureSources(): Promise<NativeCaptureSources> {
    const response = await this.request({ channel: 'capture.sources.v1' });
    if (!response.sources) throw new Error('native_capture_sources_missing');
    return response.sources;
  }

  async startCapture(request: NativeCaptureRequest): Promise<NativeCaptureResult> {
    const response = await this.request({ channel: 'capture.start.v1', ...request });
    if (response.state !== 'recording' || !response.capability) {
      throw new Error('native_capture_start_invalid');
    }
    return { state: response.state, capability: response.capability };
  }

  async stopCapture(): Promise<'idle'> {
    const response = await this.request({ channel: 'capture.stop.v1' });
    if (response.state !== 'idle') throw new Error('native_capture_stop_invalid');
    return response.state;
  }

  async captureStatus(): Promise<'idle' | 'recording' | 'stopping'> {
    const response = await this.request({ channel: 'capture.status.v1' });
    if (!response.state) throw new Error('native_capture_status_missing');
    return response.state;
  }

  close(): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error('native_helper_closed'));
    }
    this.pending.clear();
    this.transport.close();
  }

  private request(command: Record<string, unknown>): Promise<HelperResponse> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('native_helper_timeout'));
      }, 5_000);
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
    else item.reject(new Error(response.error ?? 'native_helper_request_failed'));
  }
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
  return new NativeHelperClient(transport);
}
