# Development Log

## 2026-08-11 - Caption-synchronized semantic key-point reveals

### User value

- Chapter and key-point drawers now enter only `150ms` before the first supporting caption instead of appearing near the beginning of a broad chapter range.
- The title and every point reveal at their own caption-backed moment; words within each line rise independently from below.
- Condensed phrases that do not literally occur in captions use DeepSeek's semantic cue anchor with bounded local validation.

### Timing and generation

- `KeyPointMotionSegment` schema v3 adds stable `lines` with role, text, anchor cue, reveal timestamp, and exact/partial/semantic/fallback provenance.
- DeepSeek now returns `titleAnchorCueIndex` and a separate `anchorCueIndex` for every opening point and interior point.
- Local alignment refines exact phrases by their position inside a cue, accepts meaningful partial matches, and keeps semantic fallback within `80-320ms` of the selected cue start.
- Chinese partial matching requires at least two shared characters, preventing a common single character from overriding the semantic cue.
- Drawer entry uses a `280ms` media-time animation; line tokens use `70ms` staggering and `260ms` upward reveal animation.

### Compatibility

- Existing v1/v2 tracks migrate to v3; recordings with captions are realigned from their source cue ranges, while recordings without captions retain deterministic fallback timing.
- Timeline block moves shift every line reveal together, and title/point edits keep line timing and persistence synchronized.
- Preview, seek, WebCodecs, and compatibility export continue to share the same deterministic renderer.

### Baseline and verification

- Mandatory pre-change checkpoint: `a182981` (`fix: stabilize AAC timestamps during MP4 export`).
- Focused semantic timing, parser, renderer, and migration tests pass.
- Full media/task regression: 51 tests passed.
- Export editor generation, persistence/reload, and local fallback: 2 E2E tests passed.

## 2026-08-11 - Unified export task center and stable editor toolbar

### User value

- Added one task center at the far right of the export header for export, ChatCut, noise reduction, key-point motion, captions, dubbing, cursor analysis, and waveform generation.
- Kept preview playback, seek, background changes, and timeline editing available while an export uses an immutable start-time snapshot.
- Replaced disabled prerequisite actions with clickable guidance; running actions locate their existing task instead of changing size or duplicating work.

### Task orchestration

- Added generic media-task runners with single-flight task identity, serial local-heavy execution, parallel network execution, cancellation, retry, checkpoints, phase, ETA, and result references.
- Moved the provider to own task lifecycle beyond export-page panel mounts. Recoverable ASR and dubbing checkpoints resume after refresh; interrupted local work remains paused for retry.
- Added a coalesced Web Audio completion cue and a locally persisted sound toggle.
- Export configuration is cloned when work starts, so later edits affect preview and the next export only.
- Split task actions from reactive task state so frequent progress updates do not rerender the full export page or preview canvas.

### Interface

- Added a top-right count badge and a dynamically measured panel constrained to the settings column.
- The task list is the only progress surface. Legacy preview overlays, toolbar percentages, caption upload blocks, dubbing progress bars, and cursor-analysis pills were removed.
- Rebuilt the Timeline toolbar as exactly two stable rows. Compact widths shorten labels without creating a third row or horizontal page overflow.
- Added a portal-based task creation flight and centralized task cancellation, retry, and dismissal.

### Baseline and verification

- Mandatory pre-change checkpoint: `aa0c842` (`docs: require local checkpoints before changes`).
- `npm run typecheck` passed.
- `npm run build` passed with the existing ONNX/Hugging Face static-analysis warnings.
- Media task coordinator and media pipeline: 44 tests passed.
- Focused editor regression: clickable prerequisites, strict two-row toolbar, settings-column task geometry, portal noise menu, ChatCut persistence/undo, cursor analysis, subtitle repaint, and English dubbing all passed.

## 2026-08-11 - Web chapter and key-point drawer motion

### User value

- Reworked `Generate key point motion` into an editorial chapter-and-emphasis system instead of repeating caption sentences in cards.
- Chapter openings use a B-style chapter drawer; meaningful interior moments use a C-style stack of concise key points.
- Every visible line reveals word by word from below while the directional drawer enters from its own edge.

### Generation and validation

- Added a Pro-authenticated DeepSeek route that sends caption cues, timestamps, duration, and locale only; audio and video remain local.
- Added a stable JSON-mode system prompt with chapter boundaries, evidence cue indices, output examples, and explicit Chinese/English brevity rules.
- Chinese key points are limited to 2-5 Han characters; English key points are limited to 1-4 words and 28 visible characters.
- Invalid full sentences, duplicate phrases, unsupported cue ranges, and overlapping generated moments are rejected or normalized before persistence.
- DeepSeek/network failure uses an explicit local fallback and never clears an existing editable track.

### Motion and composition

- Left/right drawers cover the complete fixed video-frame height; top/bottom drawers cover its complete width.
- Semi-transparent black gradients are strongest at the selected edge and fade toward the video center.
- Right, left, top, and bottom placements enter and exit through the matching edge.
- Word-level opacity and vertical offsets are deterministic functions of media time, keeping seek, pause, preview, WebCodecs, and compatibility export consistent.
- The effect remains clipped inside the fixed recording frame and does not resize Autozoom, camera, subtitles, backgrounds, or the output canvas.

### Compatibility

- `KeyPointMotionSegment` schema v2 adds `chapter_drawer` and `key_points_drawer`.
- Existing `chapter_title`, `side_card`, and `lower_third` segments migrate to their nearest v2 drawer behavior during load and persistence.
- Timeline editing now exposes only the B/C drawer choices and shows AI, local fallback, or failure status.

### Verification

- `npm run typecheck` passed.
- `npx playwright test tests/e2e/media-pipeline.spec.ts` passed all 40 tests, including B/C classification, matching-edge entry/exit, word staggering, range normalization, and v1 migration.
- `E2E_BASE_URL=http://localhost:3027 npx playwright test tests/e2e/editor-interactions.spec.ts` passed 31 of 34 tests; the two transient preview/export failures passed on isolated rerun. The pre-existing English dubbing activation test remains failing because its localized track does not appear within the test timeout.
- DeepSeek response handling, caption-only request data, local fallback, B/C editing, persistence, and reload all passed their editor E2E coverage.
- `npm run build` passed with the existing ONNX/Hugging Face static-analysis warnings.

## 2026-08-10 - Web editor enhancements

### Baseline

- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`
- Branch: `codex/recovered-53c2`
- Pre-development checkpoint: `b34678d`
- Scope: Web editor only. macOS work must start from the verified feature commit in a separate worktree.

### Highlight track

- Added a dedicated editable Highlight timeline track with free-form region move and resize.
- Added Spotlight, Focus frame, Cursor halo, and Text callout options.
- Highlight coordinates are normalized before Autozoom and projected through the same content transform.
- Enter and exit animation is a deterministic media-time function, so seek, pause, preview, WebCodecs, and compatibility export render the same state.
- Composition order keeps Highlight inside the fixed recording frame and below camera, key-point motion, captions, and watermark.

### Background-noise reduction

- Added Standard, Enhanced, and Original audio choices in the editor toolbar.
- Standard mode performs local speech cleanup. Enhanced mode uses local RNNoise with WebGPU-independent WASM execution.
- Compressed audio is decoded sequentially with Mediabunny and transferred to the Worker in bounded PCM chunks.
- Source audio remains immutable. Results are stored as derived `EnhancedAudioTrack` rows and activated by metadata reference.
- Preview audio, waveform generation, caption input, and export resolve the same active derived track.
- IndexedDB schema v15 adds `enhancedAudioTracks`; recording deletion removes associated derived tracks.

### Key-point motion

- Added the `Generate key point motion` editor action and a dedicated editable timeline track.
- Generation is disabled until captions exist.
- Local generation groups caption cues into editable chapter titles, side cards, and lower thirds.
- Model-shaped responses are schema-validated, sanitized, clamped to the recording, and de-duplicated before use.
- Remote DeepSeek generation is intentionally not connected until explicit user consent is recorded for sending subtitle text, timestamps, and language to that third party.
- Preview and export use deterministic media-time animation and a shared renderer.

### Editor toolbar

- Added container-aware one-row/two-row layout for editing actions and timeline controls.
- Narrow editor containers keep controls inside the editor without page-level horizontal overflow.

### Interfaces and persistence

- Added `HighlightEffectSegment`, `KeyPointMotionSegment`, `NoiseReductionMode`, and `EnhancedAudioTrack`.
- Added recording/export references for Highlight, key-point motion, and active enhanced audio.
- Added sanitized persistence helpers for Highlight and key-point motion segments.

### English dubbing compatibility

- Added Kokoro-compatible IEEE Float32 WAV parsing at the dubbing assembly boundary.
- Normalized validated Float32 samples to PCM16 before timeline assembly so preview and export consume one canonical localized track.
- Kept audible peak/RMS validation so silent or malformed model output cannot be saved as a successful dub.

### Verification

- `npm run typecheck`
- `npx playwright test tests/e2e/media-pipeline.spec.ts`: 37 passed.
- `npx playwright test tests/e2e/editor-interactions.spec.ts`: 32 passed.
- Focused final regression for Highlight, key-point motion, Standard/Enhanced noise reduction, and English dubbing: 4 passed.
- `npm run build`: passed; only upstream ONNX/Hugging Face static-analysis warnings remain.
- Editor E2E covers Standard and Enhanced noise reduction, free Highlight regions, key-point persistence, localized audio, captions, camera, Autozoom, background, and export wiring.

### Status

- Web implementation and production verification are complete except the consent-gated remote DeepSeek request.
- The verified feature commit is the required baseline for the separate macOS Phase 1 worktree.

## 2026-08-11 - Export toolbar clarity and reorderable clip sequence

### Baseline

- Mandatory pre-change checkpoint: `63afb78` (`feat: add unified export task center`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Branch: `codex/recovered-53c2`.

### Toolbar and task center

- Editing actions now always render as icon plus text. Compact containers use horizontal row overflow instead of hiding labels.
- Added fixed-width `Basic` / `Advanced` group headings so the first control in both rows has the same left edge.
- Moved timeline zoom, fit, and kept-duration controls into a dedicated right-aligned transport strip above the tracks.
- Reset and ChatCut Undo now use the shared conventional Undo icon while retaining their text labels.
- Reduced the bottom scrub hint and current-time typography to the same 12px scale as toolbar selects.
- Completed task entries remain visible for exactly 3,000ms before leaving the task list.

### Reorderable clip sequence

- Split video clips are draggable. Array order is now the authoritative preview and export order.
- Added `normalizeSegmentSequence()` to clamp invalid ranges while preserving order and adjacent split boundaries.
- Removed source-time sorting from recording segment persistence.
- Preview frame mapping, WebCodecs composition, ffmpeg frame generation, and audio concatenation consume the same ordered sequence.
- Timeline clip and fallback waveform geometry use output-time positions, while source timestamps remain non-destructive references into the original media.

### Verification

- Type checking passed.
- MP4 timestamp writer, real mp4-muxer regression, exact task retention, and clip sequence domain tests passed.
- Focused Chromium E2E passed for persistent clip drag reorder and responsive two-row toolbar layout.
