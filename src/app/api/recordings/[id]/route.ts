import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  deleteCloudRecording,
  getCloudRecording,
  removeCloudRecordingObjects,
  updateCloudRecordingTitle,
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

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  let body: { title?: string | null };
  try {
    body = (await req.json()) as { title?: string | null };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (body.title === undefined) {
    return NextResponse.json({ error: 'no_fields_to_update' }, { status: 400 });
  }
  const row = await getCloudRecording(userId, id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const next = typeof body.title === 'string' ? body.title.trim() : null;
  await updateCloudRecordingTitle(userId, id, next && next.length > 0 ? next : null);
  return NextResponse.json({ ok: true });
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
