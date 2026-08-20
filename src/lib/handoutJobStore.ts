import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type HandoutJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface HandoutJob {
  id: string;
  userId: string;
  recordingId: string;
  status: HandoutJobStatus;
  attemptCount: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredHandoutJob {
  id: string;
  user_id: string;
  recording_id: string;
  status: HandoutJobStatus;
  attempt_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: StoredHandoutJob | null): HandoutJob | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    recordingId: row.recording_id,
    status: row.status,
    attemptCount: row.attempt_count,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function storeError(prefix: string, error: { code?: string; message: string }): Error {
  return Object.assign(new Error(`${prefix}: ${error.message}`), { code: error.code });
}

export async function createHandoutJob(params: {
  id: string;
  userId: string;
  recordingId: string;
}): Promise<HandoutJob> {
  const now = new Date().toISOString();
  const { data, error } = await createSupabaseAdminClient()
    .from('handout_jobs')
    .insert({
      id: params.id,
      user_id: params.userId,
      recording_id: params.recordingId,
      status: 'pending',
      attempt_count: 0,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) throw storeError('create_handout_job', error);
  return fromRow(data as StoredHandoutJob)!;
}

export async function getHandoutJob(id: string, userId?: string): Promise<HandoutJob | undefined> {
  let query = createSupabaseAdminClient().from('handout_jobs').select('*').eq('id', id);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw storeError('get_handout_job', error);
  return fromRow(data as StoredHandoutJob | null);
}

export async function claimHandoutJob(id: string, staleAfterMs = 5 * 60_000): Promise<HandoutJob | undefined> {
  const current = await getHandoutJob(id);
  if (!current || current.status === 'done' || current.status === 'failed') return undefined;
  if (current.status === 'running' && Date.now() - current.updatedAt < staleAfterMs) return undefined;

  const updatedAt = new Date().toISOString();
  let query = createSupabaseAdminClient()
    .from('handout_jobs')
    .update({
      status: 'running',
      attempt_count: current.attemptCount + 1,
      error: null,
      updated_at: updatedAt,
    })
    .eq('id', id)
    .eq('status', current.status);
  if (current.status === 'running') {
    query = query.lte('updated_at', new Date(Date.now() - staleAfterMs).toISOString());
  }
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw storeError('claim_handout_job', error);
  return fromRow(data as StoredHandoutJob | null);
}

export async function updateHandoutJob(
  id: string,
  patch: { status: HandoutJobStatus; error?: string },
): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from('handout_jobs')
    .update({
      status: patch.status,
      error: patch.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw storeError('update_handout_job', error);
}
