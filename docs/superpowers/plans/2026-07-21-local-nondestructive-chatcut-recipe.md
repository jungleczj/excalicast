> **Status:** planned only. Do not execute or wire this into runtime until explicitly approved.

# Local non-destructive editing + ChatCut resource recipe

## Summary

For the later “agent-assisted edit” capability, use a local, non-destructive recipe model:

- Excalicast remains the source of truth for recordings, tracks, captions, segments, and export settings.
- The agent generates an edit recipe that references existing local recording assets and timeline ranges.
- ChatCut receives a resource recipe for optional external composition/export work.
- No original media chunk, whiteboard event stream, caption track, or database record is rewritten by the agent.

## Proposed flow

1. Read the current recording metadata, existing `segments`, captions, detected silences/transitions, aspect ratios, and selected export target.
2. Produce an intermediate recipe:
   - retained ranges
   - removed ranges
   - optional caption cleanup suggestions
   - optional chapter/title cards
   - referenced asset IDs only, not duplicated binary media
3. Preview the recipe inside Excalicast as a reversible draft.
4. If the user chooses ChatCut handoff later, translate the draft into a ChatCut resource recipe that references the same local assets.
5. Persist only the user-approved draft as timeline metadata; never mutate the source recording.

## Non-goals for the current implementation

- No ChatCut execution.
- No agent-generated edits applied automatically.
- No upload, destructive trimming, media rewriting, or background export changes.
- No payment, permission, API, database migration, or route changes.

## Acceptance criteria before implementation

- A recipe can be applied, reverted, and compared with the original recording.
- Export output is reproducible from the recipe and source assets.
- The user can inspect which segments are removed before saving.
- ChatCut handoff remains optional and is not required for local export.
