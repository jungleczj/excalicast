# Bug Log

## 2026-08-11 - Export tasks distorted the toolbar and stopped with panel lifecycle

### Symptom

- ChatCut, noise reduction, key-point generation, captions, dubbing, cursor analysis, and export each displayed progress in a different place.
- Dynamic percentages and status sentences changed button widths, clipped controls, or covered the preview.
- Buttons became grey and unclickable when a prerequisite or paid tier was missing, leaving no direct recovery path.
- Caption and dubbing work owned by their panel could abort when the user switched tabs or pages.

### Root cause

- Every feature implemented its own React state, AbortController, progress UI, and persistence loop.
- Export progress was passed back into the preview and rendered as a full blocking overlay.
- Availability was represented with native or ARIA disabled semantics instead of an actionable reason.
- Local decode/analyze/encode tasks had no shared resource scheduler and could contend for the same browser media resources.

### Fix

- Introduced a layout-level media task coordinator and a single top-right task center.
- Serialized local-heavy work while allowing network-only jobs to run concurrently.
- Removed distributed progress surfaces and kept only final content, actionable errors, and the central task list.
- Made prerequisites and running states clickable: they guide to captions/audio/payment or locate the existing task.
- Added immutable export snapshots, recoverable remote checkpoints, completion sounds, and explicit cancellation/retry controls.

### Regression coverage

- Domain tests cover queue ordering, network concurrency, duplicate suppression, snapshot immutability, checkpoints, and completion cues.
- Editor tests cover two-row toolbar stability, clickable prerequisites, task-count placement, and panel boundaries.
- Existing preview, Highlight, key-point, noise-reduction, export, and media-pipeline suites remain part of the release gate.

### Status

- Fixed and verified. Type checking and production build pass; 44 task/media tests and the focused export-editor regressions pass.

## 2026-08-11 - Local dubbing test path required a production login

### Symptom

Local English dubbing failed with `login_required` before the mocked translation endpoint was called.

### Root cause

ASR treated localhost as a local media-job environment, but dubbing only checked `NEXT_PUBLIC_MEDIA_JOB_MOCKS`. It therefore attempted a private Supabase authorization upload even when the local API was intentionally mocked.

### Fix

Aligned dubbing with ASR: localhost, `127.0.0.1`, and IPv6 localhost use the local media-job path and skip the private authorization upload. Production hosts still require authenticated private Storage.

### Regression coverage

The English dubbing editor E2E now reaches translation, Kokoro synthesis, localized-track activation, preview audio binding, and export selection without a Supabase login.

### Status

- Fixed locally.

## 2026-08-11 - Generated key-point motion repeated captions in generic cards

### Symptom

`Generate key point motion` produced rounded chapter/side/lower-third cards whose title was often a truncated caption sentence. Direction, hierarchy, text density, and entry motion did not match the intended chapter-opening and interior-key-point treatment.

### Root cause

- The editor action never called DeepSeek; it always used a deterministic local caption selector.
- Local generation copied the selected caption into `title` instead of performing semantic condensation.
- The renderer scaled and faded a bounded card, so an item placed on the right did not behave as a full-height right-edge drawer.
- Text was painted as complete lines, with no media-time word reveal.

### Fix

- Connect a caption-only DeepSeek JSON generation route with a fixed editorial prompt and evidence-cue contract.
- Validate concise Chinese/English key points and map chapter openings to B drawers and interior moments to C drawers.
- Replace card drawing with directional semi-transparent black gradients clipped to the fixed video frame.
- Derive drawer travel and per-word upward reveal from media time, including matching-edge exit.
- Preserve offline/service-failure behavior through a clearly identified local fallback and migrate schema-v1 tracks.

### Regression coverage

- Tests reject full-sentence Chinese points, verify B/C classification, enforce v1 migration, and check same-edge drawer travel.
- Tests verify semantic token staggering and non-overlapping generated ranges.
- Editor E2E verifies AI and local paths, durable persistence, and the B/C layout controls.

### Status

- Fixed and verified in the Web editor. Type checking, the 40-test media suite, both key-point editor E2E paths, and the production build pass. The unrelated pre-existing English dubbing activation E2E remains a known failure.

## 2026-08-10 - Background-noise menu was clipped below the editor toolbar

### Symptom

The `Remove background noise` dropdown opened inside the Timeline but was partially hidden behind the editor surface.

### Root cause

The menu was absolutely positioned inside the toolbar's horizontal scroll container. CSS overflow axis normalization made that ancestor clip vertical content, so increasing the menu `z-index` could not move it above the clipping boundary.

### Fix

- Render the menu into `document.body` through a React Portal.
- Use fixed positioning anchored to the trigger and recompute it on window resize or ancestor scrolling.
- Flip above the trigger near the viewport bottom and clamp the menu within horizontal viewport bounds.
- Close on selection, outside pointer input, or Escape while preserving the existing noise-processing actions.

### Regression coverage

- E2E verifies that the menu is a direct body child, uses fixed positioning, remains inside the viewport, and is visible above the scrollable toolbar.
- Standard and Enhanced background-noise processing continue to complete after the interaction change.

### Status

- Fixed and verified locally.

## 2026-08-10 - Editor effect tracks disappeared after refresh

### Symptom

Highlight and generated key-point motion segments were present in IndexedDB before refresh but disappeared during page reload.

### Root cause

An unmount cleanup started new asynchronous IndexedDB writes using an obsolete empty editor state. Browser document teardown does not guarantee ordering or completion for those writes, allowing the stale cleanup to overwrite the already persisted track.

### Fix

- Removed asynchronous persistence from React unmount cleanup.
- Kept bounded debounce persistence during ordinary editing.
- Made the discrete key-point generation action await its durable write before reporting success.

### Regression coverage

- E2E now reads the persisted field directly before reload and verifies the restored timeline after reload for both track types.

### Status

- Fixed and verified locally.

## 2026-08-10 - Kokoro dubbing rejected as unsupported WAV

### Symptom

English dubbing failed with `dubbing_audio_unsupported_wav`, so no audible localized track reached preview or export.

### Root cause

Kokoro returns Hugging Face `RawAudio`. Its `toWav()` encoder writes IEEE Float32 WAV (`audioFormat=3`, 32-bit), while the Excalicast parser accepted only integer PCM16 WAV (`audioFormat=1`, 16-bit).

### Fix

- Accept valid Float32 WAV input at the dubbing assembly boundary.
- Reject non-finite or truncated samples.
- Clamp Float32 samples and normalize them to canonical PCM16 before timeline assembly.
- Keep the existing audible peak/RMS validation so a syntactically valid silent result cannot be saved as success.

### Regression coverage

- A Kokoro-format Float32 WAV fixture now reproduces and verifies normalization.
- The complete editor E2E verifies translation job polling, local Worker output, localized-track persistence, preview audio binding, and export audio selection.

### Status

- Fixed and verified locally.

## 2026-08-10 - Noise reduction retained full decoded audio in memory

### Symptom

The first implementation sent bounded chunks to the Worker but still called `arrayBuffer()` and `decodeAudioData()` for the complete recording first. Long recordings could create high memory pressure and garbage-collection stalls.

### Root cause

Chunking started after full-file decoding, so it bounded Worker messages but not the main-thread compressed and PCM residency.

### Fix

- Replaced full-buffer decode with Mediabunny `BlobSource` streaming and `AudioSampleSink` sequential decoding.
- Downmix and resample each decoded sample into a bounded two-second mono buffer.
- Close every decoded sample immediately and dispose the input on success, failure, or cancellation.

### Regression coverage

- Standard and RNNoise Enhanced modes both complete in the editor E2E.
- The derived track activates without overwriting the source audio.

### Status

- Fixed and verified locally.
