export type PrivateMediaJobKind = 'asr' | 'dubbing';

export interface MediaSubmitPayload {
  recordingId: string;
  assetPath: string;
  bytes: number;
  mimeType: string;
  cameraAssetPath?: string;
  cameraBytes?: number;
  cameraMimeType?: string;
}

function segment(value: string): string {
  const clean = value.trim();
  if (!clean || clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\')) {
    throw new Error('invalid_media_path_segment');
  }
  return clean;
}

export function buildPrivateMediaPath(
  userId: string,
  recordingId: string,
  kind: PrivateMediaJobKind,
  filename: string,
): string {
  return `${segment(userId)}/${segment(recordingId)}/jobs/${kind}/${segment(filename)}`;
}

export function isOwnedPrivateMediaPath(
  userId: string,
  path: string,
  recordingId?: string,
  kind?: PrivateMediaJobKind,
): boolean {
  try {
    const prefix = recordingId && kind
      ? `${segment(userId)}/${segment(recordingId)}/jobs/${kind}/`
      : `${segment(userId)}/`;
    return path.startsWith(prefix) && !path.split('/').some((part) => part === '..' || part === '.');
  } catch {
    return false;
  }
}

export function parseMediaSubmitPayload(value: unknown): MediaSubmitPayload {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  const input = value as Record<string, unknown>;
  if (typeof input.recordingId !== 'string' || !input.recordingId.trim()) {
    throw new Error('missing_recording_id');
  }
  if (typeof input.assetPath !== 'string' || !input.assetPath.trim()) {
    throw new Error('asset_path_required');
  }
  if (typeof input.bytes !== 'number' || !Number.isFinite(input.bytes) || input.bytes <= 0) {
    throw new Error('invalid_asset_bytes');
  }
  if (typeof input.mimeType !== 'string' || !input.mimeType.trim()) {
    throw new Error('invalid_asset_mime_type');
  }
  if (input.cameraAssetPath != null && typeof input.cameraAssetPath !== 'string') {
    throw new Error('invalid_camera_asset_path');
  }
  return {
    recordingId: input.recordingId,
    assetPath: input.assetPath,
    bytes: input.bytes,
    mimeType: input.mimeType,
    ...(typeof input.cameraAssetPath === 'string' ? { cameraAssetPath: input.cameraAssetPath } : {}),
    ...(typeof input.cameraBytes === 'number' ? { cameraBytes: input.cameraBytes } : {}),
    ...(typeof input.cameraMimeType === 'string' ? { cameraMimeType: input.cameraMimeType } : {}),
  };
}
