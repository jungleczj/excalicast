import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription, createSubtitleJob, updateSubtitleJob } from '@/lib/db';
import { TIER_PERMISSIONS } from '@/types/user';
import { mockSrt } from '@/services/qwenAsr';
import { isOwnedPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  // 1) Auth + tier check (Pro 以上)
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
    (status === 'active' || status === 'paused') && TIER_PERMISSIONS[tier].subtitle;
  if (!entitled) {
    return NextResponse.json(
      { error: 'tier_required', message: '字幕功能需要 Pro 订阅' },
      { status: 403 },
    );
  }

  const hasApiKey = !!process.env.DASHSCOPE_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const isLocalhost = !appUrl || /localhost|127\.0\.0\.1/.test(appUrl);
  let recordingId = '';
  let assetPath: string | undefined;
  let assetBytes: number | undefined;
  let mimeType: string | undefined;
  try {
    const body = await req.json() as Record<string, unknown>;
    if ((isLocalhost || !hasApiKey) && body.localMock === true && typeof body.recordingId === 'string') {
      recordingId = body.recordingId;
    } else {
      const parsed = parseMediaSubmitPayload(body);
      recordingId = parsed.recordingId;
      assetPath = parsed.assetPath;
      assetBytes = parsed.bytes;
      mimeType = parsed.mimeType;
      if (!isOwnedPrivateMediaPath(userId, assetPath)) throw new Error('forbidden_asset_path');
      if (assetBytes > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_request', message: err instanceof Error ? err.message : 'parse_failed' },
      { status: 400 },
    );
  }

  // 3) Persist only the private object path. Audio bytes never cross this function.
  const jobId = randomUUID();
  await createSubtitleJob({ id: jobId, userId, recordingId, assetPath, assetBytes, mimeType });

  // 4) Dev / no-API-key fallback：直接给 mock SRT，方便本地 E2E
  if (!hasApiKey || isLocalhost) {
    const reason = !hasApiKey
      ? '(语音服务未配置，使用示例字幕)'
      : '(本地环境无法被语音服务回调，使用示例字幕；部署到公网后自动启用)';
    await updateSubtitleJob(jobId, {
      status: 'done',
      srt: `# ${reason}\n${mockSrt()}`,
    });
    return NextResponse.json({ jobId, mock: true, reason });
  }

  // 5) Real path：异步提交 DashScope（client polls /api/asr/status）
  // 这里只标记为 running，提交动作放在 status 路由的第一次轮询时做（避免 submit 路由被长任务阻塞）
  await updateSubtitleJob(jobId, { status: 'pending' });
  return NextResponse.json({ jobId, mock: false });
}
