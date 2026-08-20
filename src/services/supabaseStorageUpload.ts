'use client';

import * as tus from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';

const CHUNK_SIZE = 6 * 1024 * 1024;
const DIRECT_UPLOAD_LIMIT = 8 * 1024 * 1024;

export function resolveSupabaseUploadMode(bytes: number): 'direct' | 'tus' {
  return bytes < DIRECT_UPLOAD_LIMIT ? 'direct' : 'tus';
}

function resumableEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) throw new Error('supabase_url_missing');
  const url = new URL(configured);
  // Supabase recommends the direct storage hostname for large TUS uploads;
  // self-hosted/local URLs keep their configured host.
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  }
  url.pathname = '/storage/v1/upload/resumable';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function uploadSupabaseStorageObject(params: {
  bucket: string;
  path: string;
  blob: Blob;
  cacheControl?: string;
  upsert?: boolean;
  signal?: AbortSignal;
  onProgress?: (uploaded: number, total: number) => void;
}): Promise<void> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('login_required');

  const contentType = params.blob.type || 'application/octet-stream';
  if (resolveSupabaseUploadMode(params.blob.size) === 'direct') {
    if (params.signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    params.onProgress?.(0, params.blob.size);
    const { error } = await supabase.storage.from(params.bucket).upload(params.path, params.blob, {
      upsert: params.upsert ?? true,
      contentType,
      cacheControl: params.cacheControl ?? '3600',
    });
    if (error) throw error;
    if (params.signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    params.onProgress?.(params.blob.size, params.blob.size);
    return;
  }

  await new Promise<void>((resolve, reject) => {
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
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(params.upsert === false ? {} : { 'x-upsert': 'true' }),
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: params.bucket,
        objectName: params.path,
        contentType,
        cacheControl: params.cacheControl ?? 'no-cache',
      },
      onError: (error) => finish(() => reject(error)),
      onProgress: (uploaded, total) => params.onProgress?.(uploaded, total),
      onSuccess: () => finish(resolve),
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
