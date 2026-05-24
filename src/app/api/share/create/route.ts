import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/tier';
import { createShareLinkForRecording } from '@/services/shareLinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/share/create
 *  body: { recordingId: string }
 *  → { shortCode, url, expiresAt }
 *
 * 要求：tier === 'max' + recording 已云端备份。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;

  let body: { recordingId?: string };
  try {
    body = (await req.json()) as { recordingId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const recordingId = body.recordingId;
  if (!recordingId || typeof recordingId !== 'string') {
    return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  if (!appUrl) {
    return NextResponse.json(
      { error: 'app_url_not_configured', message: '服务器未配置 NEXT_PUBLIC_APP_URL' },
      { status: 500 },
    );
  }

  try {
    const result = await createShareLinkForRecording({
      userId: guard.userId,
      recordingId,
      appUrl,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('cloud_recording_required')) {
      return NextResponse.json({ error: 'cloud_recording_required', message: msg }, { status: 409 });
    }
    return NextResponse.json({ error: 'share_create_failed', message: msg }, { status: 500 });
  }
}
