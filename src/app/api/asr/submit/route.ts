import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscription, createSubtitleJob, getSubtitleJob, updateSubtitleJob } from '@/lib/db';
import { TIER_PERMISSIONS } from '@/types/user';
import { mockSrt } from '@/services/qwenAsr';
import { isOwnedPrivateMediaPath, parseMediaSubmitPayload } from '@/lib/privateMedia';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { verifyPrivateMediaAsset } from '@/lib/privateMediaStorage';
import {
  executeMediaJobSubmission,
  mediaJobFailurePayload,
  mediaJobFailureStatus,
  reportMediaJobFailure,
} from '@/lib/mediaJobDiagnostics';

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
  let sub;
  try {
    sub = await getUserSubscription(userId);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('asr.submit.entitlement', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
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
      if (!isOwnedPrivateMediaPath(userId, assetPath, recordingId, 'asr')) throw new Error('forbidden_asset_path');
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

  const jobId = randomUUID();
  let admin: ReturnType<typeof createSupabaseAdminClient> | undefined;
  try {
    const result = await executeMediaJobSubmission({
      verifyStorage: async () => {
        if (!assetPath || !assetBytes) return;
        admin = createSupabaseAdminClient();
        await verifyPrivateMediaAsset(admin, assetPath, assetBytes);
      },
      createJob: async () => {
        await createSubtitleJob({ id: jobId, userId, recordingId, assetPath, assetBytes, mimeType });
        return { jobId, mock: false as const };
      },
      afterCreate: async () => {
        if (!hasApiKey || isLocalhost) {
          const reason = !hasApiKey
            ? '(语音服务未配置，使用示例字幕)'
            : '(本地环境无法被语音服务回调，使用示例字幕；部署到公网后自动启用)';
          await updateSubtitleJob(jobId, userId, {
            status: 'done',
            srt: `# ${reason}\n${mockSrt()}`,
          });
          return { jobId, mock: true, reason };
        }
        return { jobId, mock: false };
      },
      confirmJobCreated: async () => !!(await getSubtitleJob(jobId, userId)),
      cleanupAssets: async () => {
        if (admin && assetPath) await admin.storage.from('recordings').remove([assetPath]);
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const failure = mediaJobFailurePayload(error, 'database');
    reportMediaJobFailure('asr.submit', failure);
    return NextResponse.json(failure, { status: mediaJobFailureStatus(failure) });
  }
}
