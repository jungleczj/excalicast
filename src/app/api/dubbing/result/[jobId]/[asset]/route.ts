import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDubbingJob, readLocalDubbingAsset } from '@/lib/dubbingStore';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params { params: { jobId: string; asset: string } }

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const job = await getDubbingJob(params.jobId, user.id);
  if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  if (job.status !== 'done') return NextResponse.json({ error: 'job_not_done' }, { status: 409 });
  if (params.asset === 'subtitles.srt') {
    return new NextResponse(job.localizedSrt ?? job.translatedSrt ?? '', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const isAudio = params.asset === 'audio.wav';
  const isCamera = params.asset === 'camera.webm';
  const assetPath = isAudio ? job.dubbedAudioPath : isCamera ? job.lipSyncCameraPath : undefined;
  const contentType = isAudio ? (job.dubbedAudioType ?? 'audio/wav') : (job.lipSyncCameraType ?? 'video/webm');
  if (!assetPath) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
  let blob: Blob | null = null;
  if (assetPath.startsWith(`${user.id}/`)) {
    const { data, error } = await createSupabaseAdminClient().storage.from('recordings').download(assetPath);
    if (error || !data) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
    blob = data;
  } else {
    const bytes = await readLocalDubbingAsset(assetPath);
    if (bytes) blob = new Blob([toArrayBuffer(bytes)], { type: contentType });
  }
  if (!blob) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });
  return new NextResponse(blob, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } });
}
