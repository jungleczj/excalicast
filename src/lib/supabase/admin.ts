import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw Object.assign(new Error('Supabase service role is not configured'), {
      code: 'SUPABASE_ADMIN_NOT_CONFIGURED',
    });
  }
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'excalicast-media-jobs' } },
    });
  }
  return client;
}
