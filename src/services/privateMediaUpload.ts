'use client';

import * as tus from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';
import { buildPrivateMediaPath, type PrivateMediaJobKind } from '@/lib/privateMedia';

const CHUNK_SIZE = 6 * 1024 * 1024;
const DIRECT_UPLOAD_LIMIT = 8 * 1024 * 1024;

export function resolvePrivateUploadMode(bytes: number): 'direct' | 'tus' {
  return bytes < DIRECT_UPLOAD_LIMIT ? 'direct' : 'tus';
}

function resumableEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) throw new Error('supabase_url_missing');
  const projectId = new URL(configured).hostname.split('.')[0];
  if (!projectId) throw new Error('supabase_project_id_missing');
  return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
}

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
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  const user = userData.user;
  const accessToken = sessionData.session?.access_token;
  if (!user?.id || !accessToken) throw new Error('login_required');
  const path = buildPrivateMediaPath(
    user.id,
    params.recordingId,
    params.kind,
    `${params.jobNonce}-${params.filename}`,
  );

  if (resolvePrivateUploadMode(params.blob.size) === 'direct') {
    if (params.signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    params.onProgress?.(0, params.blob.size);
    const { error } = await supabase.storage.from('recordings').upload(path, params.blob, {
      upsert: true,
      contentType: params.blob.type || 'application/octet-stream',
      cacheControl: '0',
    });
    if (error) throw error;
    if (params.signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    params.onProgress?.(params.blob.size, params.blob.size);
    return {
      path,
      bytes: params.blob.size,
      mimeType: params.blob.type || 'application/octet-stream',
    };
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      params.signal?.removeEventListener('abort', abort);
      fn();
    };
    const upload = new tus.Upload(params.blob, {
      endpoint: resumableEndpoint(),
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      headers: { authorization: `Bearer ${accessToken}` },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: 'recordings',
        objectName: path,
        contentType: params.blob.type || 'application/octet-stream',
        cacheControl: 'no-cache',
      },
      onError: (error) => finish(() => reject(error)),
      onProgress: (uploaded, total) => params.onProgress?.(uploaded, total),
      onSuccess: () => finish(() => resolve({
        path,
        bytes: params.blob.size,
        mimeType: params.blob.type || 'application/octet-stream',
      })),
    });
    const abort = () => {
      void upload.abort(true).finally(() => finish(() => reject(new DOMException('Upload aborted', 'AbortError'))));
    };
    if (params.signal?.aborted) {
      abort();
      return;
    }
    params.signal?.addEventListener('abort', abort, { once: true });
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch((error) => finish(() => reject(error)));
  });
}

export async function removePrivateJobAssets(paths: Array<string | null | undefined>): Promise<void> {
  const clean = paths.filter((path): path is string => !!path);
  if (clean.length === 0) return;
  const supabase = createClient();
  await supabase.storage.from('recordings').remove(clean);
}
