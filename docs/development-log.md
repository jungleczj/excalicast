# Development Log

## 2026-09-03 - SEO content-system quality gates (intentional RED)

### Baseline

- Mandatory Task 4 baseline: `7a9adf5a2f8f0417e7bba51a139c8212a7134572`.
- Worktree: `/Users/chenzhijiang/.claude/projects/excalicast/.worktrees/pro`; branch: `fix/loading-recording`.

### Implementation

- Added `tests/e2e/seo-content-quality.spec.ts` with a quote-aware CSV parser, keyword-to-slug mapping contracts, five core-article Top3 quality thresholds, a short-paragraph ceiling check, and structured evidence-block requirements.
- Extended `tests/e2e/seo-routes.spec.ts` with a wave `1`/`2`/`3` slug reservation contract that requires every planned blog slug to exist in `BLOG_ENTRIES` and both localized sitemap outputs.

### Verification

- Ran `npx playwright test tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts --reporter=line`.
- Result: intentional RED with `8 failed, 15 passed (26.2s)`.
- Existing Next/ONNX static-analysis warnings appeared during the test web server startup and were not the cause of failure.

### Expected failing assertion names

- `how-to-screen-record-on-windows-11 English total word count`
- `screencasting-guide English total word count`
- `best-screen-recorder-for-mac English total word count`
- `whiteboard-animation-and-hand-drawn-explainers English total word count`
- `whiteboard-animation-software-comparison English total word count`
- `how-to-screen-record-on-windows-11 Pick the right Windows 11 screen recorder paragraph 1 exceeds the 240-character paragraph ceiling`
- `how-to-screen-record-on-windows-11 visual evidence block count`
- `record-screen-with-audio-on-mac should exist in BLOG_ENTRIES`

## 2026-08-21 - Adaptive English dubbing timeline and localized key-point motion

### Baseline

- Mandatory pre-change checkpoint: `ffe174d` (`chore: checkpoint before adaptive dubbing timeline`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`; branch: `fix/loading-recording`.

### User value

- English speech is fitted with a natural `0.9x-1.15x` speaking-rate range using the measured TTS duration, not a text estimate alone.
- Short English phrases remove excess source pauses while retaining a 150ms breath; long phrases receive a local video-time window instead of clipped or overlapping speech.
- English captions and generated key-point motion use the localized presentation clock. Returning to the source version restores the existing Chinese captions and Chinese key points without regeneration.

### Implementation

- Added a persisted source-to-localized timing map with separate source, presentation, and audio clocks.
- Edge TTS performs one bounded adaptive re-synthesis when real audio duration requires a meaningful rate correction.
- Dubbing assembly retimes the translated SRT and places each verified WAV chunk on the localized timeline.
- TTS chunk cache fingerprints include translated text, target duration, and voice, so the final adaptive-rate MP3 is reusable without crossing incompatible timing windows.
- Preview and export map localized presentation time back to original video/camera frames while captions and key-point animation stay on the English clock.
- A newly generated English track automatically creates and persists English key-point motion from its retimed English captions; source-language assets remain on recording metadata.

### Compatibility

- Legacy localized tracks without a timing map retain the previous one-to-one timeline.
- Added a Supabase migration for `localized_srt` and `timing_map`; local SQLite adds the same fields lazily.
- The existing non-destructive source recording, source captions, source key points, and source audio remain unchanged.

### Verification

- `npx tsc --noEmit --incremental false` passed.
- 113 dubbing, media-pipeline, media-task, and migration tests passed.
- The focused editor E2E passed with English dubbing active in preview/export and an automatically generated English key-point segment.
- `npm run build` passed; only the existing ONNX/Kokoro/mpg123 static dependency warnings remain.

## 2026-08-13 - Multi-recording main track and hybrid long-form preview

### Baseline

- Mandatory pre-change checkpoint: `ddc5de0` (`chore: checkpoint before multi-clip editing`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`; branch: `codex/recovered-53c2`.

### User value

- The Basic toolbar can import several existing library recordings in one action.
- Imported recordings become movable, splittable, trimmable and removable main-track clips, then export as one joined file.
- Insertions occur at the project playhead and preserve the user's selection order.
- Long projects use a bounded lower-resolution composition budget during playback while paused seeks still render the original frame accurately.

### Implementation

- Added a persisted `MainTrackClip[]` project model with output-to-source time mapping and project-range effect mapping.
- Added the recording-library multi-select dialog and main-track drag ordering to the existing Timeline.
- Preview swaps media sources at clip boundaries and keeps one project clock; playback updates no longer recreate the animation loop on every frame.
- Export renders clips sequentially, concatenates the compatible video segments and prepares all selected audio as one continuous 48 kHz PCM timeline before a single final audio encode.
- Empty main tracks are persisted after reset, preventing removed imports from returning after reload.

### Verification

- Main-track domain, effect mapping, hybrid-preview policy and continuous multi-clip audio tests passed.
- Recording import, persistence and Timeline zoom UI tests passed against the local editor.
- No recording or export quality, bitrate, frame rate or resolution was reduced.

## 2026-08-13 - Export failure isolation and local-heavy lock release

### Baseline and diagnosis

- Mandatory pre-change checkpoint: `8c138cd` (`chore: checkpoint before export failure investigation`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`; branch: `codex/recovered-53c2`.
- Deterministic RED tests proved that completion persistence could both fail a completed export and retain the next `local_heavy` task, while codec error objects lost their message.
- A second RED cycle proved that audio preparation was not normalized/preflighted before frame rendering and that failed tasks lost the concrete phase already reported by the Provider.
- The recording resource gate itself does not cancel, restart, or throttle export work; recording-time IndexedDB pressure amplified the coordinator persistence defect instead.

### Implementation

- Media task state now settles independently of IndexedDB persistence. Local-heavy serialization covers the real runner, not task-history writes after the runner completes.
- Error-like values are converted into real `Error` objects, preserving codec/storage messages through the Provider and task center.
- Export audio decode/resample starts in parallel with setup, is preflighted once before frame 0, and the same resolved PCM/WAV is reused by every encoder path.
- WebCodecs fallback now distinguishes deterministic frame/media composition failures from genuine hardware codec/decoder failures.
- Failed task status retains the last concrete phase plus structured details/diagnostics.

### Verification

- Dedicated RED→GREEN regression suites: 8 tests passed.
- Media coordinator, media pipeline, and export regressions: 76 tests passed.
- `npm run typecheck` passed.
- `npm run build` passed after stopping the diagnostic dev server; only the existing ONNX/Hugging Face static-analysis warnings remain.
- No recording/export resolution, frame rate, bitrate, quality setting, or output feature was reduced.

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

## 2026-08-12 - Audio repair and voice enhancement interface prototype

### Goal

- Validate the first-phase interaction model for repairing damaged source audio and actively enhancing voice quality before changing the production audio pipeline.

### Prototype

- Added a development-only, non-indexable prototype route at `/[locale]/audio-repair-prototype`.
- Shows automatic quality diagnosis, Natural / Clear Voice / Studio Repair presets, individual hiss/click/clip/hum/sibilance repairs, voice-shaping controls, original-signal preservation, and A/B auditioning.
- Keeps the visual language aligned with the export editor while isolating all state in memory; it does not read recordings, persist settings, or process audio.

### Status

- Awaiting visual and interaction approval before production audio-domain design and implementation.

## 2026-08-12 - Audio repair integrated into the export editor

### Baseline

- Mandatory pre-change checkpoint: `bda4f28` (`chore: checkpoint before audio repair integration`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Branch: `codex/recovered-53c2`.

### Product behavior

- Moved `Repair and enhance voice` into the existing Advanced toolbar row; it is not a separate editor or export route.
- Clicking the action opens a contextual panel inside the existing export settings column while preserving preview, Timeline, tabs, and project state.
- Added local source diagnosis, Natural / Clear Voice / Studio presets, repair controls, reversible A/B source selection, and a derived enhanced-audio Timeline lane.
- Audio repair runs through the unified task center as a local-heavy `audio_repair` task; the source track is retained and export reads the selected derived track.
- Removed the approved prototype route after integrating its interaction model into the production editor.

### Implementation

- Added normalized repair settings, stable cache fingerprints, diagnosis metrics, and repair-track metadata.
- The audio Worker performs bounded local repair before optional RNNoise enhancement; no recording audio is uploaded.
- Cached repair tracks are reused only when the source fingerprint and complete settings fingerprint match.
- The production editor keeps noise reduction and source repair as separate task states so one tool cannot impersonate the other.

### Verification

- `npm run typecheck`: passed.
- `npm run build`: passed; only existing ONNX/Hugging Face static-analysis warnings remain.
- Audio-repair domain tests: 3 passed.
- Toolbar, popover, prerequisite, side-panel, Standard/Enhanced denoise, repair-track persistence, preview binding, and Timeline derived-track E2E: 5 passed.

## 2026-08-12 - Subtitle-driven key-point motion language

### Behavior

- Key-point motion now uses the dominant language of the complete subtitle track instead of the export page locale.
- Chinese-dominant captions produce one consistently Chinese track; English-dominant captions produce one consistently English track.
- Mixed captions resolve once for the whole track, preventing adjacent chapter and key-point drawers from switching languages.
- Non-linguistic captions retain the interface language only as a fallback hint.

### Implementation

- Added `resolveKeyPointMotionLanguage()` as the shared deterministic language boundary.
- The export page resolves subtitle language before task creation and reuses it for DeepSeek generation and local fallback.
- The key-point API independently resolves language from validated subtitle cues, so a client hint cannot override detectable caption content.
- Prompt construction also resolves from cues and explicitly requires all titles and points to remain in that language.

### Verification

- Added regressions for English UI with Chinese captions, Chinese UI with English captions, mixed-language dominance, and non-linguistic fallback.
- Focused language tests passed after reproducing both the missing resolver and page-locale prompt failure.

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

## 2026-08-13 - Unified continuous export audio timeline

### Baseline

- Mandatory pre-change checkpoint: `f1d3a48` (`chore: checkpoint before audio continuity fixes`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Branch: `codex/recovered-53c2`.

### Product behavior

- Original microphone audio, noise-reduced audio, repaired voice, and English dubbing now enter one 48 kHz mono PCM export contract.
- New microphone recordings request 48 kHz mono Opus at 128 kbps while retaining the browser-granted sample rate and channel count for diagnosis.
- MP4 audio is encoded as 48 kHz mono AAC-LC at 160 kbps in both WebCodecs and ffmpeg paths.
- Timeline cuts and reordered clips are applied once at PCM sample boundaries. Intentional microphone mute and dubbing silence remain intact.
- Localized speech chunks receive a 5ms edge fade to suppress splice clicks without changing their scheduled duration.

### Implementation

- Added `prepareExportAudio()` as the only audio entry into export. Browser audio decoding performs the one required high-quality resample for legacy 16 kHz, 44.1 kHz, or 24 kHz sources.
- Legacy recordings that enter noise reduction or voice repair use a bounded, stateful cubic resampler; chunk boundaries retain interpolation context and cannot reset the waveform.
- WebCodecs and ffmpeg consume the same prepared PCM. The ffmpeg fallback no longer rereads or retrims the original WebM.
- AAC callbacks are validated for missing, duplicate, or overlapping access units and remapped to a cumulative 1024-sample clock before MP4 muxing.
- Derived processing must preserve every decoded sample; empty, silent, non-finite, clipped, or sample-short output cannot become a ready track.
- Export diagnostics now record source track, source kind, sample count, duration, peak, invalid samples, encoder path, and fallback reason.
- Cloud import preserves optional microphone source diagnostics while remaining compatible with legacy recordings.

## 2026-08-13 - Recording resource isolation and local diagnostics

### Baseline

- Mandatory pre-change checkpoint: `50d7f1d` (`chore: checkpoint before goodall fix`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Branch: `codex/recovered-53c2`.

### Product behavior

- Active recording now owns an explicit resource-gate lease without changing capture resolution, frame rate, video bitrate, microphone sample rate, or audio bitrate.
- Analytics delivery, Paddle background refresh, route prefetch, and heavy whiteboard hover prewarming voluntarily defer while capture is active.
- Existing exports, ChatCut, noise reduction, dubbing, and other media tasks are never aborted or restarted when recording begins.
- Each completed recording stores a local-only diagnostic summary of true same-origin/WAN transfer bytes, long tasks, IndexedDB write backlog, write latency, persisted bytes, and storage growth.

### Implementation

- Added a reference-counted `RecordingResourceGate`; it exposes state and idle notification but has no authority to throttle MediaRecorder or cancel tasks.
- Extended `ChunkWriteBatcher` with an ordered pending-batch drain and pressure metrics. Every accepted chunk is retained until its IndexedDB transaction succeeds or reports a final failure.
- Audio, camera, and display recorder handles expose read-only write diagnostics.
- Recording finalization snapshots Resource Timing synchronously, releases deferred work, and saves storage diagnostics in the background so export-page navigation is not delayed.
- Diagnostic reports aggregate byte counts only and never persist request URLs, media blobs, or personal identifiers.

### Verification

- Type checking passed.
- Focused resource, write-backpressure, quality-baseline, and recording-lifecycle tests passed.
- Production build is required before the feature commit.

### Verification

- Audio domain and dubbing regression suites cover callback reordering, missing AAC frames, source-kind parity, silence retention, clipping rejection, clip reordering, and dubbing edge fades.
- Real Chromium round-trip covers `Float32 WAV -> prepared PCM -> AAC -> H.264 MP4 -> decoded PCM` and verifies 48 kHz mono output, bounded duration error, and no internal silence gap.
- Type checking and production build are required before the feature commit.
## 2026-08-13 - Realtime preview clock and single-pass export recovery

### Baseline

- Mandatory pre-change baseline: `0a2fe71` (`feat: add multi-recording timeline and stabilize export tasks`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Branch: `codex/recovered-53c2`.

### Product behavior

- Preview playback now follows the active audio media clock and coalesces delayed frames instead of repeatedly cancelling the frame currently being composed.
- Long recordings update the editor playhead at preview cadence rather than forcing a full React render on every animation frame.
- Export audio that exceeds digital full scale is transparently peak-normalized to `-1 dBFS`; aspect-ratio changes no longer expose a false clipping failure.
- AAC or Opus encoder failure keeps the hardware-rendered video and performs audio-only compatibility remuxing instead of re-rendering every video frame in software.

### Implementation

- Added `resolvePreviewPlaybackClock()` and separate seek-versus-playback scheduling semantics to `LatestTaskRunner`.
- Reused preview content and foreground canvases to reduce large per-frame allocations and garbage collection.
- Audio preparation runs alongside frame composition, and Float WAV creation is lazy unless ffmpeg actually needs it.
- Direct audio encoding settles before muxer selection; video chunks stream into the selected muxer with a bounded 64-chunk startup buffer.

### Verification

- TypeScript check passed with incremental output disabled.
- 71 media and export fallback regression tests passed in Chromium.

## 2026-08-20 - Durable, readable English dubbing

### Baseline

- Mandatory pre-change checkpoint: `8e10be7` (`chore: checkpoint before dubbing quality and performance fix`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`.
- Branch: `fix/loading-recording`.

### Product behavior

- Edge TTS and Azure Speech now keep adjacent phrases readable when synthesized speech exceeds the source cue window.
- Dense translated phrases use a bounded natural speed increase rather than being mixed with the following phrase.
- Translation survives a function restart and is not repeated when synthesis resumes.
- Long synthesis keeps its durable claim alive as chunks complete.

### Implementation

- Centralized English speech-rate estimation in the dubbing audio domain.
- Changed timeline assembly to stable chronological placement with non-overlapping PCM ranges and short edge fades.
- Split the server job into persisted translation and synthesis stages without adding a new database column.
- Added a narrow `touchDubbingJob()` update so progress heartbeats do not rewrite the complete job row.

### Verification

- Type checking passed.
- Production build passed with only the existing ONNX/Kokoro bundler warnings.
- 35 focused dubbing and durable media-job regression tests passed.

## 2026-08-16 - Realtime preview scrubbing during playback

### Baseline

- Mandatory pre-change checkpoint: `f618802` (`chore: checkpoint before realtime preview scrubbing`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`.
- Branch: `fix/loading-recording`.

### Product behavior

- The preview progress bar remains directly draggable while playback is running.
- Holding the pointer freezes the old playback clock and renders each newly requested source time instead of letting playback pull the playhead back.
- Releasing the pointer resumes audio, camera, display playback, and the project clock from the final dragged position.
- Pointer events support mouse, pen, and touch scrubbing through the same interaction path.

### Implementation

- Added an explicit preview-bar scrubbing session with separate output and source timestamps.
- Paused media clocks during the interaction while preserving the visible playing state.
- Precise scrub requests abort obsolete frame composition and publish only the latest completed frame.
- Added a rendered-frame timestamp diagnostic on the preview stage for end-to-end verification.

### Verification

- The editor E2E holds the pointer at 75%, verifies the playhead and rendered frame remain at that position, then verifies playback advances after release.

## 2026-08-17 - Automatic English voice selection with Azure Speech F0

### Baseline

- Mandatory pre-change checkpoint: `62df4e4` (`chore: checkpoint before azure dubbing`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`.
- Branch: `fix/loading-recording`.

### Product behavior

- English dubbing analyzes a bounded local sample of the original microphone track and automatically selects a lower or higher English neural voice.
- Users can override automatic selection with explicit Male or Female controls before generation.
- DeepSeek continues to translate timestamped SRT; Azure Speech receives only translated English text and never receives the original recording.
- Azure Speech F0 is preferred when configured. Missing credentials preserve the quantized browser-local Kokoro fallback.
- Voice choice, local profile, billable character count, and synthesis chunk count persist with the durable job and localized track.

### Implementation

- Added a local autocorrelation analyzer capped at 12 seconds and 160 analysis frames.
- Added Andrew/Ava voice mapping, escaped SSML, bounded speaking-rate fitting, sequential phrase synthesis, subtitle-timeline WAV assembly, and transient 429/5xx retries.
- Shortened synthesis chunks to natural phrase windows and updated the translation prompt for spoken rhythm and cue duration.
- Classified Azure dubbing as a network task and added the Supabase migration plus Azure deployment variables.

### Verification

- Voice mapping, manual override, Blob decoding, SSML safety, Azure retry, timeline assembly, Kokoro fallback, and cancellation tests pass.
- Type checking, the 17-test dubbing suite, production build, Max gating, and generated-track preview/export activation pass.
## 2026-08-20 - Durable free Edge dubbing pipeline

### Baseline

- Mandatory pre-change checkpoint: `7df71c0` (`chore: checkpoint before dubbing pipeline repair`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`.
- Branch: `fix/loading-recording`.

### Product behavior

- Free English dubbing continues to use DeepSeek translation and Edge neural voices.
- Ten-minute transcripts are grouped into bounded 20-30 second speech requests instead of dozens of short WebSocket sessions.
- Translation, synthesis, decode, assembly, upload, and save stages now report real chunk progress.
- Refreshes and transient failures resume from private MP3 chunks; identical recording, subtitle, and voice requests reuse verified work.
- Edge failure no longer silently starts Kokoro. The user receives an explicit local-model fallback action.

### Implementation

- Replaced server-side Mediabunny MP3 decoding with Node-compatible `mpg123-decoder` WASM and strict PCM quality gates.
- Added durable `dubbing_job_chunks`, per-job phase diagnostics, bounded six-chunk processing, adaptive three-way retry batches, and private Storage chunk caching.
- Split side-effect-free status reads from bounded processing requests.
- Added real Edge MP3 and ffmpeg-reference WAV fixtures to detect decoder distortion.

### Verification

- Type checking passed.
- Production build passed.
- 26 focused dubbing tests passed, including real MP3 decode correlation, truncation rejection, long transcript grouping, and read-only polling.

## 2026-08-21 - Reversible source and English editing variants

### Baseline

- Mandatory pre-change checkpoint: `d44c7b8` (`chore: checkpoint before localized editing variants`).
- Worktree: `/Users/chenzhijiang/.codex/worktrees/53c2/fix-loading-recording`.
- Branch: `fix/loading-recording`.

### Product behavior

- Each English dubbing track owns its translated subtitles and English key-point motions.
- Restoring the original audio immediately restores the original Chinese subtitles and Chinese key-point motions without regeneration.
- Re-selecting a previously generated English track restores that track's saved English editing assets.

### Implementation

- Added optional key-point motions to localized tracks while keeping source-language motions on recording metadata.
- The editor resolves captions, generation language, timeline motions, preview, and export from the active language variant.
- Key-point edits persist to the active variant instead of overwriting the source-language track.

## 2026-09-01 - SEMrush keyword clusters and search-intent content

### Baseline

- Requested baseline `8399ef3 feat: adapt english dubbing timeline and key points` was not present in the local object database.
- The implementation started from a clean `fix/loading-recording` worktree and did not change recording, dubbing, export, payment, or storage behavior.

### Product behavior

- Four bilingual guides now cover eight qualified US search terms from SEMrush without creating near-duplicate Windows or animation pages.
- The guides describe native Windows and macOS options before positioning Excalicast, and explicitly distinguish structured whiteboard capture from ordinary display-pixel capture.
- Animation content states that Excalicast is not a frame-by-frame character-animation suite.

### Research and implementation

- Added a reproducible keyword CSV, a 16-competitor research report, per-keyword Top 3 content structures, and a 90-day SEMrush execution plan.
- Added official Microsoft, Apple, and Walt Disney Animation sources to the relevant guides.
- Added a content test that enforces the one-cluster-per-keyword mapping, minimum article structure, and FAQ coverage.

## 2026-09-02 - SEMrush opportunity expansion applied to the site

### Product behavior

- Added a bilingual whiteboard animation software comparison guide targeting the comparison-chart, comparison, software, and best-software query family on one useful page rather than separate doorway pages.
- Added a bilingual Snagit alternative comparison with explicit fit boundaries for screenshot capture, reusable asset libraries, and structured whiteboard explanation workflows.
- Refreshed the Screen Studio comparison, Loom alternatives guide, and whiteboard explainer guide with the exact qualified search language, current source links, internal cluster links, and verification dates.

### Verification

- The new keyword-cluster test was observed failing before implementation and passing afterward.
- Type checking passed.
- The production build generated 122 static pages successfully.
- All 24 SEO route and rendered-page Playwright tests passed against the production build.
