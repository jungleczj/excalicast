import type { RecordingMetadata } from '@/types/recording';

const RECOVERY_WARNING = 'browser_session_ended_before_finalization';

export function recoverUnfinishedRecording(
  recording: RecordingMetadata,
  estimatedDurationMs: number,
): RecordingMetadata {
  const warnings = Array.from(new Set([...(recording.warnings ?? []), RECOVERY_WARNING]));
  return {
    ...recording,
    durationMs: Math.max(recording.durationMs, Math.round(estimatedDurationMs)),
    status: 'interrupted',
    interruptionRequestedAt: undefined,
    warnings,
  };
}
