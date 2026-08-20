'use client';

import { createClient } from '@/lib/supabase/client';
import { buildPrivateMediaPath, type PrivateMediaJobKind } from '@/lib/privateMedia';
import {
  resolveSupabaseUploadMode,
  uploadSupabaseStorageObject,
} from '@/services/supabaseStorageUpload';

export const resolvePrivateUploadMode = resolveSupabaseUploadMode;

export interface PrivateMediaUploadResult {
  path: string;
  bytes: number;
  mimeType: string;
}

export async function uploadPrivateJobAsset(params: {
  recordingId: string;
  kind: PrivateMediaJobKind;
  jobNonce: string;
  filename: string;
  blob: Blob;
  signal?: AbortSignal;
  onProgress?: (uploaded: number, total: number) => void;
}): Promise<PrivateMediaUploadResult> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user?.id) throw new Error('login_required');
  const path = buildPrivateMediaPath(
    user.id,
    params.recordingId,
    params.kind,
    `${params.jobNonce}-${params.filename}`,
  );

  await uploadSupabaseStorageObject({
    bucket: 'recordings',
    path,
    blob: params.blob,
    cacheControl: '0',
    upsert: true,
    signal: params.signal,
    onProgress: params.onProgress,
  });
  return {
    path,
    bytes: params.blob.size,
    mimeType: params.blob.type || 'application/octet-stream',
  };
}

export async function removePrivateJobAssets(paths: Array<string | null | undefined>): Promise<void> {
  const clean = paths.filter((path): path is string => !!path);
  if (clean.length === 0) return;
  const supabase = createClient();
  await supabase.storage.from('recordings').remove(clean);
}
