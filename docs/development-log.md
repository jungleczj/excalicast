# Development Log

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
