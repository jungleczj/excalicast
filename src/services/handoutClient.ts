'use client';

import { withCaptureResourceLease } from '@/desktop/captureResourceGate';

export interface HandoutJobStatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
  recordingId?: string;
  error?: string;
}

export class HandoutClientError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'HandoutClientError';
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new HandoutClientError(body.error ?? `http_${response.status}`, body.message ?? body.error);
  return body;
}

export async function submitHandoutJob(recordingId: string, signal?: AbortSignal): Promise<{ jobId: string }> {
  return withCaptureResourceLease(async (leaseSignal) => {
    const response = await fetch('/api/handout/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingId }),
      signal: leaseSignal,
    });
    return readJson<{ jobId: string }>(response);
  }, { signal });
}

export async function pollHandoutJob(jobId: string, signal?: AbortSignal): Promise<HandoutJobStatusResponse> {
  return withCaptureResourceLease(async (leaseSignal) => {
    const response = await fetch(`/api/handout/status?jobId=${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
      signal: leaseSignal,
    });
    return readJson<HandoutJobStatusResponse>(response);
  }, { signal });
}
