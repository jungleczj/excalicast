# Development Log

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
