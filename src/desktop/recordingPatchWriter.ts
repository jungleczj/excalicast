import type {
  NativeTeachingCompositionLifecycle,
  RecordingMetadata,
  RecordingTeachingEditRecipeV1,
} from '@/types/recording';

export interface NativeTeachingRecordingPatch {
  teachingRecipeStatus: NonNullable<RecordingMetadata['teachingRecipeStatus']>;
  teachingComposition?: NativeTeachingCompositionLifecycle;
  teachingEditRecipe?: RecordingTeachingEditRecipeV1;
}

export function createRevisionedRecordingPatchWriter(
  write: (recordingId: string, patch: NativeTeachingRecordingPatch) => Promise<void>,
): {
  enqueue(recordingId: string, patch: NativeTeachingRecordingPatch): Promise<void>;
} {
  const revisions = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();
  return {
    enqueue(recordingId, patch) {
      const revision = (revisions.get(recordingId) ?? 0) + 1;
      revisions.set(recordingId, revision);
      const previous = tails.get(recordingId) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(async () => {
        if (revisions.get(recordingId) !== revision) return;
        await write(recordingId, structuredClone(patch));
      });
      tails.set(recordingId, current);
      void current.finally(() => {
        if (tails.get(recordingId) === current) tails.delete(recordingId);
      }).catch(() => undefined);
      return current;
    },
  };
}
