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
  error?: string;
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
