import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/tier';
import { getHandoutByRecording, deleteHandout } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ recordingId: string }> }

/**
 * GET  /api/handout/[recordingId]
 *  → 当前用户该录制是否已生成讲义，返回 { outline, markdown, model, generatedAt } 或 404。
 *
 * DELETE /api/handout/[recordingId]
 *  → 删掉当前用户该录制的讲义（用于"重新生成"前清旧值，或用户手动撤销）。
 *
 * 两者都要 Max。
 */

export async function GET(req: Request, { params }: Ctx): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;
  const { recordingId } = await params;
  if (!recordingId) return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });

  const row = await getHandoutByRecording(guard.userId, recordingId);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // outline 是 jsonb，下游 ExpectChapters[]; 这里原样返回
  return NextResponse.json({
    outline: row.outline,
    markdown: row.markdown,
    model: row.model,
    generatedAt: row.generatedAt,
  });
}

export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  const guard = await requireTier(req, 'max');
  if ('error' in guard) return guard.error;
  const { recordingId } = await params;
  if (!recordingId) return NextResponse.json({ error: 'missing_recording_id' }, { status: 400 });

  try {
    await deleteHandout(guard.userId, recordingId);
  } catch (err) {
    return NextResponse.json(
      { error: 'handout_delete_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
