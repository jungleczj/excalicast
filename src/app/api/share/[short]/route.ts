import { NextResponse } from 'next/server';
import { getShareLinkByCode, getCloudRecording, bumpShareLinkAccessCount, expireShareLink } from '@/lib/db';
import { signRecordingObjects } from '@/services/shareLinks';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ short: string }> }

/**
 * GET /api/share/[short]
 *  公开端点（不要求登录）。
 *  → { recordingId, title, durationMs, hasAudio, hasCamera, urls: {...} }
 *  过期 / 不存在 → 404。
 */
export async function GET(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { short } = await params;
  if (!short) return NextResponse.json({ error: 'missing_code' }, { status: 400 });

  const link = await getShareLinkByCode(short);
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (link.expiresAt <= Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  // 拿到 recording 元数据（包括 hasAudio/hasCamera/title），用 owner id 查 recordings_cloud
  const cloud = await getCloudRecording(link.userId, link.recordingId);
  if (!cloud) return NextResponse.json({ error: 'recording_missing' }, { status: 404 });

  let urls;
  try {
    urls = await signRecordingObjects(cloud.storagePrefix, cloud.hasAudio, cloud.hasCamera);
  } catch (err) {
    return NextResponse.json(
      { error: 'sign_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }

  // 异步计数（不阻塞响应）
  void bumpShareLinkAccessCount(link.id);

  return NextResponse.json({
    recordingId: cloud.id,
    title: cloud.title,
    durationMs: cloud.durationMs,
    hasAudio: cloud.hasAudio,
    hasCamera: cloud.hasCamera,
    subtitleSrt: cloud.subtitleSrt,
    expiresAt: link.expiresAt,
    urls,
  });
}

/**
 * DELETE /api/share/[short]
 *  Owner 软删（expires_at = now()）。
 */
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { short } = await params;
  const link = await getShareLinkByCode(short);
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (link.userId !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    await expireShareLink(link.id, user.id);
  } catch (err) {
    return NextResponse.json(
      { error: 'expire_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
