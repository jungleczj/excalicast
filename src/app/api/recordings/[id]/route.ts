import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  deleteCloudRecording,
  getCloudRecording,
  removeCloudRecordingObjects,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const row = await getCloudRecording(userId, id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ recording: row });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const row = await getCloudRecording(userId, id);
  if (!row) return NextResponse.json({ ok: true, alreadyGone: true });
  try {
    await removeCloudRecordingObjects(row.storagePrefix);
  } catch (err) {
    // If files were already deleted by the user via RLS, swallow and continue
    // to remove the DB row anyway.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('removeCloudRecordingObjects failed:', err);
    }
  }
  await deleteCloudRecording(userId, id);
  return NextResponse.json({ ok: true });
}
