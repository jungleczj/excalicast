export type DubbingJobStep = 'wait' | 'translate' | 'synthesize';

export function resolveDubbingJobStep(
  job: { status: 'pending' | 'running' | 'done' | 'failed'; updatedAt: number; translatedSrt?: string },
  now = Date.now(),
): DubbingJobStep {
  if (job.status === 'running' && now - job.updatedAt < 120_000) return 'wait';
  return job.translatedSrt?.trim() ? 'synthesize' : 'translate';
}
