import {
  MediaJobDiagnosticError,
  type MediaJobFailurePayload,
} from '@/lib/mediaJobDiagnostics';

function isFailurePayload(value: unknown): value is MediaJobFailurePayload {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<MediaJobFailurePayload>;
  return input.error === 'media_job_failed'
    && typeof input.code === 'string'
    && typeof input.stage === 'string'
    && typeof input.cause === 'string';
}

export async function parseMediaJobResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null) as T | MediaJobFailurePayload | { error?: unknown; message?: unknown } | null;
  if (!response.ok) {
    if (isFailurePayload(json)) throw new MediaJobDiagnosticError(json, response.status);
    const fallback = json && typeof json === 'object'
      ? ('message' in json ? json.message : 'error' in json ? json.error : undefined)
      : undefined;
    throw new Error(typeof fallback === 'string' ? fallback : `request_failed_${response.status}`);
  }
  if (!json) throw new Error('invalid_response');
  return json as T;
}
