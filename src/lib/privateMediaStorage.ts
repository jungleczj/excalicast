import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

function storageError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export async function verifyPrivateMediaAsset(
  supabase: SupabaseClient,
  path: string,
  expectedBytes: number,
): Promise<void> {
  const slash = path.lastIndexOf('/');
  if (slash <= 0 || slash === path.length - 1) throw storageError('STORAGE_OBJECT_NOT_FOUND');
  const folder = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from('recordings').list(folder, {
    limit: 100,
    search: filename,
  });
  if (error) throw error;
  const object = data?.find((item) => item.name === filename);
  if (!object) throw storageError('STORAGE_OBJECT_NOT_FOUND');
  const actualBytes = Number(object.metadata?.size);
  if (Number.isFinite(actualBytes) && actualBytes > 0 && actualBytes !== expectedBytes) {
    throw storageError('STORAGE_SIZE_MISMATCH');
  }
}
