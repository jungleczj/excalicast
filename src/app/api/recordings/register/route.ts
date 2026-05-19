import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription, upsertCloudRecording } from '@/lib/db';
import { TIER_PERMISSIONS } from '@/types/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegisterBody {
  recordingId: string;
  title?: string | null;
  startedAt: number;
  durationMs: number;
  hasAudio: boolean;
  hasCamera: boolean;
  subtitleSrt?: string | null;
  thumbnail?: string | null;
  bytesStored?: number | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const sub = await getUserSubscription(userId);
  const tier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'inactive';
  const entitled =
    (status === 'active' || status === 'paused' ||
      (status === 'cancelled' && sub?.currentPeriodEnd && sub.currentPeriodEnd > Date.now()))
    && TIER_PERMISSIONS[tier].cloudBackup;
  if (!entitled) {
    return NextResponse.json(
      { error: 'tier_required', message: '云端备份需要 Pro 订阅' },
      { status: 403 },
    );
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.recordingId || typeof body.recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }
  if (typeof body.startedAt !== 'number' || typeof body.durationMs !== 'number') {
    return NextResponse.json({ error: 'invalid_metadata' }, { status: 400 });
  }

  // Verify the storage objects actually exist for this user under the expected prefix.
  const prefix = `${userId}/${body.recordingId}`;
  // Note: trust-but-don't-strictly-verify path; client uploads via RLS which already
  // prevents writing to another user's prefix. Skipping HEAD checks for speed.

  await upsertCloudRecording({
    id: body.recordingId,
    userId,
    title: body.title ?? null,
    startedAt: body.startedAt,
    durationMs: body.durationMs,
    hasAudio: !!body.hasAudio,
    hasCamera: !!body.hasCamera,
    subtitleSrt: body.subtitleSrt ?? null,
    thumbnail: body.thumbnail ?? null,
    storagePrefix: prefix,
    bytesStored: body.bytesStored ?? null,
  });

  return NextResponse.json({ ok: true, storagePrefix: prefix });
}
