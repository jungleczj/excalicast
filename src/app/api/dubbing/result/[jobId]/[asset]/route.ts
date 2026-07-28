import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDubbingJob } from '@/lib/dubbingStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: {
    jobId: string;
    asset: string;
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const job = getDubbingJob(params.jobId);
  if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  if (job.userId !== userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (job.status !== 'done') return NextResponse.json({ error: 'job_not_done' }, { status: 409 });

  if (params.asset === 'subtitles.srt') {
    return new NextResponse(job.translatedSrt ?? '', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (params.asset === 'audio.wav' && job.dubbedAudio) {
    return new NextResponse(new Blob([toArrayBuffer(job.dubbedAudio)], { type: job.dubbedAudioType ?? 'audio/wav' }), {
      headers: {
        'Content-Type': job.dubbedAudioType ?? 'audio/wav',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (params.asset === 'camera.webm' && job.lipSyncCamera) {
    return new NextResponse(new Blob([toArrayBuffer(job.lipSyncCamera)], { type: job.lipSyncCameraType ?? 'video/webm' }), {
      headers: {
        'Content-Type': job.lipSyncCameraType ?? 'video/webm',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
}
