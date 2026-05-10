import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { auth } from '@/auth';
import { getUserSubscription, createSubtitleJob, updateSubtitleJob } from '@/lib/db';
import { saveAudio } from '@/lib/asrStore';
import { TIER_PERMISSIONS } from '@/types/user';
import { mockSrt } from '@/services/qwenAsr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB DashScope limit

export async function POST(req: Request): Promise<NextResponse> {
  // 1) Auth + tier check (Pro 以上)
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const sub = getUserSubscription(userId);
  const tier = sub?.tier ?? 'free';
  const status = sub?.status ?? 'inactive';
  const entitled =
    (status === 'active' || status === 'paused') && TIER_PERMISSIONS[tier].subtitle;
  if (!entitled) {
    return NextResponse.json(
      { error: 'tier_required', message: 'AI 字幕需要 Pro 订阅' },
      { status: 403 },
    );
  }

  // 2) Parse multipart audio + recordingId
  let recordingId: string;
  let audioBytes: Uint8Array;
  try {
    const form = await req.formData();
    const recordingIdRaw = form.get('recordingId');
    if (typeof recordingIdRaw !== 'string' || !recordingIdRaw) {
      return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });
    }
    recordingId = recordingIdRaw;
    const file = form.get('audio');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'missing_audio' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'audio_too_large' }, { status: 413 });
    }
    audioBytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_request', message: err instanceof Error ? err.message : 'parse_failed' },
      { status: 400 },
    );
  }

  // 3) Create job + persist audio
  const jobId = randomUUID();
  const audioToken = randomUUID().replace(/-/g, '');
  await saveAudio(audioToken, audioBytes);
  createSubtitleJob({ id: jobId, userId, recordingId, audioToken });

  // 4) Dev / no-API-key fallback：直接给 mock SRT，方便本地 E2E
  const hasApiKey = !!process.env.DASHSCOPE_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const isLocalhost = !appUrl || /localhost|127\.0\.0\.1/.test(appUrl);

  if (!hasApiKey || isLocalhost) {
    const reason = !hasApiKey
      ? '(无 DASHSCOPE_API_KEY，使用 mock SRT)'
      : '(本地环境 DashScope 无法回调 localhost，使用 mock SRT；部署到公网后自动启用真实千问)';
    updateSubtitleJob(jobId, {
      status: 'done',
      srt: `# ${reason}\n${mockSrt()}`,
    });
    return NextResponse.json({ jobId, mock: true, reason });
  }

  // 5) Real path：异步提交 DashScope（client polls /api/asr/status）
  // 这里只标记为 running，提交动作放在 status 路由的第一次轮询时做（避免 submit 路由被长任务阻塞）
  updateSubtitleJob(jobId, { status: 'pending' });
  return NextResponse.json({ jobId, mock: false });
}
