export type MediaJobStage =
  | 'auth'
  | 'authorization'
  | 'request'
  | 'configuration'
  | 'storage'
  | 'database'
  | 'external_service';

export interface MediaJobFailurePayload {
  error: 'media_job_failed';
  code: string;
  stage: MediaJobStage;
  cause: string;
}

interface ErrorShape {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
}

function errorShape(error: unknown): ErrorShape {
  if (error instanceof Error) return { ...(error as unknown as ErrorShape), message: error.message };
  if (error && typeof error === 'object') return error as ErrorShape;
  return { message: String(error ?? '') };
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const code = String(value).toUpperCase();
  return /^[A-Z0-9_-]{2,64}$/.test(code) ? code : undefined;
}

function externalStatus(message: string): string | undefined {
  const match = message.match(/(?:failed|status|http)\s+(\d{3})(?:\D|$)/i);
  return match?.[1];
}

export function mediaJobFailurePayload(error: unknown, fallbackStage: MediaJobStage): MediaJobFailurePayload {
  if (error instanceof MediaJobDiagnosticError) return error.diagnostic;

  const shape = errorShape(error);
  const message = typeof shape.message === 'string' ? shape.message : '';
  const errorName = typeof shape.error === 'string' ? shape.error : '';
  const rawCode = safeCode(shape.code);
  const statusCode = safeCode(shape.statusCode ?? shape.status);

  if (rawCode === 'SUPABASE_ADMIN_NOT_CONFIGURED') {
    return { error: 'media_job_failed', code: rawCode, stage: 'configuration', cause: 'service_role_not_configured' };
  }

  if (fallbackStage === 'database') {
    if (rawCode === 'PGRST205' || rawCode === '42P01' || /table.+schema cache|relation.+does not exist/i.test(message)) {
      return { error: 'media_job_failed', code: rawCode ?? 'DATABASE_TABLE_MISSING', stage: 'database', cause: 'database_table_missing' };
    }
    if (rawCode === 'PGRST204' || rawCode === '42703' || /column.+schema cache|column.+does not exist/i.test(message)) {
      return { error: 'media_job_failed', code: rawCode ?? 'DATABASE_SCHEMA_STALE', stage: 'database', cause: 'database_schema_stale' };
    }
    if (rawCode === '42501' || /permission denied|row-level security/i.test(message)) {
      return { error: 'media_job_failed', code: rawCode ?? 'DATABASE_PERMISSION_DENIED', stage: 'database', cause: 'database_permission_denied' };
    }
    return { error: 'media_job_failed', code: rawCode ?? 'DATABASE_OPERATION_FAILED', stage: 'database', cause: 'database_operation_failed' };
  }

  if (fallbackStage === 'storage') {
    if (rawCode === 'STORAGE_OBJECT_NOT_FOUND') {
      return { error: 'media_job_failed', code: rawCode, stage: 'storage', cause: 'storage_object_missing' };
    }
    if (rawCode === 'STORAGE_SIZE_MISMATCH') {
      return { error: 'media_job_failed', code: rawCode, stage: 'storage', cause: 'storage_object_invalid' };
    }
    if (/bucket.+not found/i.test(`${errorName} ${message}`)) {
      return { error: 'media_job_failed', code: statusCode ? `STORAGE_${statusCode}` : 'STORAGE_BUCKET_NOT_FOUND', stage: 'storage', cause: 'storage_bucket_missing' };
    }
    if (statusCode === '401' || statusCode === '403' || /unauthorized|row-level security|permission denied/i.test(`${errorName} ${message}`)) {
      return { error: 'media_job_failed', code: `STORAGE_${statusCode ?? 'UNAUTHORIZED'}`, stage: 'storage', cause: 'storage_permission_denied' };
    }
    return { error: 'media_job_failed', code: rawCode ?? (statusCode ? `STORAGE_${statusCode}` : 'STORAGE_OPERATION_FAILED'), stage: 'storage', cause: 'storage_operation_failed' };
  }

  if (fallbackStage === 'external_service') {
    const status = externalStatus(message);
    return {
      error: 'media_job_failed',
      code: status ? `EXTERNAL_SERVICE_${status}` : 'EXTERNAL_SERVICE_FAILED',
      stage: 'external_service',
      cause: status && Number(status) >= 500 ? 'external_service_unavailable' : 'external_service_failed',
    };
  }

  const defaults: Record<Exclude<MediaJobStage, 'database' | 'storage' | 'external_service'>, string> = {
    auth: 'unauthenticated',
    authorization: 'not_entitled',
    request: 'invalid_request',
    configuration: 'configuration_missing',
  };
  return {
    error: 'media_job_failed',
    code: rawCode ?? `${fallbackStage.toUpperCase()}_FAILED`,
    stage: fallbackStage,
    cause: defaults[fallbackStage],
  };
}

export function mediaJobFailureStatus(payload: MediaJobFailurePayload): number {
  if (payload.stage === 'auth') return 401;
  if (payload.stage === 'authorization') return 403;
  if (payload.stage === 'request') return 400;
  if (payload.cause === 'storage_object_missing') return 409;
  if (payload.cause === 'storage_object_invalid') return 400;
  return payload.stage === 'configuration' || payload.stage === 'storage'
    || payload.stage === 'database' || payload.stage === 'external_service'
    ? 503
    : 500;
}

export class MediaJobDiagnosticError extends Error {
  readonly diagnostic: MediaJobFailurePayload;
  readonly status: number;

  constructor(diagnostic: MediaJobFailurePayload, status = mediaJobFailureStatus(diagnostic)) {
    super(diagnostic.cause);
    this.name = 'MediaJobDiagnosticError';
    this.diagnostic = diagnostic;
    this.status = status;
  }
}

export async function executeMediaJobSubmission<T, R = T>(operations: {
  verifyStorage: () => Promise<void>;
  createJob: () => Promise<T>;
  afterCreate?: (created: T) => Promise<R>;
  confirmJobCreated?: () => Promise<boolean>;
  cleanupAssets?: () => Promise<void>;
}): Promise<R> {
  const cleanupAssets = async (): Promise<void> => {
    await operations.cleanupAssets?.().catch(() => undefined);
  };
  try {
    await operations.verifyStorage();
  } catch (error) {
    await cleanupAssets();
    throw new MediaJobDiagnosticError(mediaJobFailurePayload(error, 'storage'));
  }

  let created: T;
  try {
    created = await operations.createJob();
  } catch (error) {
    let confirmedAbsent = false;
    if (operations.confirmJobCreated) {
      try {
        confirmedAbsent = !(await operations.confirmJobCreated());
      } catch {
        // An unavailable confirmation leaves the insert outcome uncertain.
      }
    }
    if (confirmedAbsent) await cleanupAssets();
    throw new MediaJobDiagnosticError(mediaJobFailurePayload(error, 'database'));
  }

  try {
    return operations.afterCreate
      ? await operations.afterCreate(created)
      : created as unknown as R;
  } catch (error) {
    throw new MediaJobDiagnosticError(mediaJobFailurePayload(error, 'database'));
  }
}

export function reportMediaJobFailure(context: string, payload: MediaJobFailurePayload): void {
  console.error('[media-job]', { context, code: payload.code, stage: payload.stage, cause: payload.cause });
}
