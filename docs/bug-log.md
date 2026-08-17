# Bug Log

## 2026-08-15 - 预览正常但导出音频明显卡顿

### Symptom

- 预览时音频正常，但导出的 MP4 音频明显卡顿/断续。

### Root cause

- WebCodecs AAC 编码把最后一块（不足 1024 帧）直接喂给 AudioEncoder；AAC-LC 要求按 1024 帧对齐，非整数帧块会被拒绝或输出错位，导致编码失败回退到 ffmpeg remux，或产生时间戳错位。
- 导出音频用 `AudioContext.decodeAudioData` 解码 MediaRecorder 分片录制的 Opus WebM，pre-skip / Cluster 边界的处理与预览（<audio> 流式解码）不一致，可能产生可闻间隙。

### Fix

- `encodeAudioTrack` 把最后一块静音补齐到 1024 帧，保证每个 AudioData 都是完整的 AAC 帧。
- 导出解码改用 Mediabunny（与降噪/修复/波形同源）+ 有状态三次插值重采样到 48kHz 单声道，替换 `decodeAudioData`。
- 提取 `StreamingCubicResampler` 到共享模块 `audioResample.ts`。

### Status

- Fixed locally; typecheck + 67 media-pipeline + 13 audio/dubbing tests passed.

## 2026-08-15 - 弱网/断网下录制启动被卡住

### Symptom

- 录制过程中（尤其是网络非常卡顿甚至没有网络时），点击开始录制后长时间无响应，录制无法启动。

### Root cause

- `getCurrentOwnerKey()` 用 `supabase.auth.getSession()` 取 ownerKey，注释假设它「只读本地存储、无网络」。实际上当 access token 临近/已过期时，`getSession()` 会发起一次网络刷新 token（`_callRefreshToken`）；弱网/断网下该请求会长时间挂起，`startRecording()` 卡在 `await getCurrentOwnerKey()`。

### Fix

- 给 `getSession()` 加 2s 超时；超时/失败时优先复用最近一次成功解析出的登录 user id，避免把登录用户的录制误归到 guest，最后才回退 guest id。

### Status

- Fixed locally; typecheck passed.

## 2026-08-15 - Stop 后跳不到导出页，导出页停在 Loading recording

### Symptom

- 停止录制后无法进入导出页，页面一直显示 `Loading recording…`（或 `Finishing recording…`）。

### Root cause

- `exportHrefForRecording` 返回了已带 locale 前缀的路径（如 `/en/export/<id>`），但 next-intl 的 `useRouter().push/replace` 在 `localePrefix: 'always'` 下会自动再加一次 locale 前缀，实际跳转到 `/en/en/export/<id>`（双前缀），无法匹配 `/[locale]/export/[id]` 路由。
- 导出页加载逻辑对 `recording/finalizing` 状态无限轮询、对 IndexedDB 读取无超时，一旦收尾卡住就永远停在加载态。

### Fix

- `exportHrefForRecording` 改为返回未加前缀的 `/export/<id>`，交给 next-intl 统一补前缀。
- 导出页加载增加：单次读取超时（8s）、总等待上限（30s），超限后把该录制本地标记为 `interrupted` 并照常打开编辑器；读取偶发失败在预算内重试而不是立即报错。

### Status

- Fixed locally; typecheck + media-lifecycle domain tests passed.

## 2026-08-13 - Long preview restarted per frame and joined audio could stutter

### Symptom

- Projects containing long or imported recordings became increasingly sluggish during preview playback.
- Independently encoded audio on adjacent imported clips could introduce encoder-delay gaps at joins.
- Clearing an imported main track could restore stale clips after a reload.

### Root cause

- The preview playback effect depended on the source time updated by its own animation frame, rebuilding the playback loop continuously.
- Encoding AAC separately for every imported clip preserved per-file priming delay before container concatenation.
- Empty main-track state was treated as “do not persist” instead of a valid cleared project state.

### Fix

- Keep project and source time in refs so one persistent playback clock survives frame updates.
- Concatenate normalized 48 kHz PCM clips with a short boundary smoothing pass, then encode and mux audio once for the complete project.
- Gate persistence on initial hydration and persist empty main-track arrays.

### Status

- Fixed locally with regression coverage for duration, sample count, Timeline import and reload persistence.

## 2026-08-13 - Export tasks failed as `media_task_failed` and retained local-heavy locks

### Symptom

- Exports intermittently ended as `media_task_failed`, hiding the browser codec or storage error that actually occurred.
- A later export could remain queued after the preceding local-heavy runner had already finished.
- Deterministic audio preparation or frame-composition failures could enter the ffmpeg compatibility path and repeat the complete frame render before failing again.

### Root cause

- `MediaTaskCoordinator` awaited task-record persistence inside the media execution promise. Slow IndexedDB completion writes therefore retained the global `local_heavy` tail, and a rejected completion write converted an already-produced video Blob into a failed media task.
- The coordinator only recognized same-realm `Error` instances; string and `{ name, message }` codec/storage rejections collapsed to `media_task_failed`.
- `prepareExportAudio()` was first awaited inside WebCodecs after video frames had been encoded. Its rejection was also inside the broad hardware fallback catch, so deterministic input failures triggered a full software re-render.
- Failure handling overwrote a reported `hardware_pipeline` or `fallback_encoding` phase with the generic `failed` phase.

### Fix

- Make task-record persistence best-effort and remove it from queued-runner startup, task completion, and the local-heavy resource-lock lifetime.
- Normalize Error, DOM-style error objects, and string rejections before storing and rethrowing them.
- Attach normalization to the audio preparation promise immediately, await it once before frame 0, and reuse the resolved PCM/WAV for WebCodecs, audio remux, and ffmpeg.
- Mark deterministic frame-composition failures so they fail once; retain ffmpeg fallback for genuine hardware encoder/decoder failures.
- Preserve the last concrete task phase and structured progress details when status changes to `failed`.

### Regression coverage

- A successful export remains completed when task persistence rejects.
- Completion persistence cannot retain the next local-heavy runner.
- Error-like codec rejections retain their real message and failure phase.
- Audio preparation fails before frame rendering, resolves only once on success, and deterministic frame-composition failures skip software re-encoding.
- Hardware codec and decoder failures still select the compatibility encoder.

### Status

- Fixed locally without changing export resolution, frame rate, bitrate, quality, or feature behavior.

## 2026-08-11 - Key-point lines appeared before their supporting captions

### Symptom

A chapter drawer could appear near the start of a broad chapter range and immediately reveal every title and point, even when the narration did not mention a later point until several seconds afterward.

### Root cause

- Generated data stored only one cue range per drawer, not an evidence cue per visible line.
- All token animation was derived from `segment.start` with a fixed global stagger.
- Persistence forced generated tracks back to schema v2, so derived line timing could not survive reload.

### Fix

- Added schema v3 line-level cue anchors and reveal timestamps.
- DeepSeek assigns each concise phrase to the first cue that supports its meaning; local matching refines exact and partial phrases and bounds semantic fallback timing.
- Drawer entry begins `150ms` before the first line, while each later line waits for its own cue and reveals its words upward.
- Persisted line timing now survives edits, block moves, reload, preview, and both export paths.

### Regression coverage

- Tests cover a point first supported at ten seconds, exact cue-internal interpolation, semantic phrases absent from the caption text, invalid AI anchors, v1/v2 migration, seek determinism, and line-level token staggering.
- Export editor E2E covers AI generation, local fallback, persistence, and reload.

### Status

- Fixed and verified locally.

## 2026-08-17 - English dubbing ignored the source voice and sounded fragmented

### Symptoms

- Every English version used the same default female Kokoro voice, even for recordings with a clearly lower masculine voice.
- Long synthesized phrases could sound rushed, uneven, or synthetic.
- Short-lived TTS throttling failed the complete dubbing job immediately.

### Root cause

- The dubbing contract stored no source voice profile or explicit voice choice.
- The local fallback used a hard-coded `af_heart` voice and broad chunk limits.
- Translation prompts did not preserve spoken rhythm, and the provider had no transient retry policy.

### Fix

- Analyze pitch locally and map it to Azure Andrew or Ava, with an explicit user override.
- Generate short timestamp-aligned phrases with bounded speaking-rate adjustment and natural-pause translation guidance.
- Persist voice and usage diagnostics, retry transient Azure failures, validate returned WAV audio, and preserve Kokoro as an audible fallback.

### Privacy and failure behavior

- Original audio remains on device during analysis and is never uploaded to Azure Speech.
- Azure receives translated English text only. A failure cannot create a silent successful track.

### Status

- Fixed and verified locally with type checking, production build, 17 dubbing regressions, and focused editor E2E.

## 2026-08-16 - Preview progress dragging did not update frames during playback

### Symptom

Dragging the preview progress bar while the video was playing moved the time value briefly, but the canvas stayed on an older frame or jumped back to the pre-drag playback position.

### Root cause

- The original playback clock continued advancing while the user dragged the progress bar.
- Playback-mode state changes intentionally skipped precise frame rendering, so controlled playhead updates did not force a seek.
- Audio and camera elements continued playing while repeated `currentTime` assignments competed with their media clocks.
- Playback resumed from a stale React `playheadMs` closure instead of the final drag position.

### Fix

- Freeze the playback clock and pause media elements for the duration of a progress-bar drag.
- Resolve and retain both project-output time and source-media time for every pointer position.
- Force the latest source frame to render while dragging, then restart all clocks from the final resolved position.
- Use pointer events so the same behavior works across mouse, pen, and touch input.

### Regression coverage

- A real whiteboard frame is rendered before playback begins.
- The E2E verifies the dragged frame is published while the pointer remains down and does not drift back after 250ms.
- The E2E verifies playback remains active and advances after pointer release.

### Status

- Fixed and verified locally.

## 2026-08-13 - Exported MP4 audio stuttered while preview audio was smooth

### Symptom

Original unprocessed recordings sounded continuous in the editor, but exported H.264 MP4 files could contain periodic cuts, timestamp errors, or audible splice artifacts. Selecting denoise, repair, or dubbing could use a different timing path.

### Root cause

- Microphone capture was constrained to 16 kHz at only 32 kbps, then decoded and resampled independently by different exporters.
- WebCodecs AAC callbacks were sorted and forced forward without proving that every encoded access unit existed.
- ffmpeg fallback reread the original compressed track and independently applied trim filters, so it did not share the WebCodecs timeline.
- Derived-track validation allowed roughly one second or two percent of duration drift, permitting missing samples to be saved as ready.
- Timed dubbing chunks were inserted with hard waveform edges.

### Fix

- Build one continuous 48 kHz mono PCM timeline and feed that exact data to both WebCodecs and ffmpeg.
- Generate AAC mux timestamps from cumulative sample count and reject missing, duplicate, or overlapping frames.
- Require exact input/output sample conservation for noise reduction and voice repair.
- Replace the derived-track linear chunk resampler with a stateful cubic resampler that produces identical output regardless of decoder chunk boundaries.
- Preserve deliberate silence and add only short fades at artificial edit or dubbing boundaries.
- Record the actual browser capture format and full audio continuity diagnostics.

### Regression coverage

- Reordered AAC callbacks are accepted only when the complete sample sequence is present; missing frames fail export.
- Original, enhanced, repaired, and dubbed tracks pass the same sample-clock contract.
- Unprocessed PCM is sample-identical before encoding, and clipped/non-finite derived tracks are rejected.
- Dubbing edge fades preserve the complete scheduled duration and late-timeline speech.
- A real H.264 MP4 browser round-trip decodes the downloaded file and rejects wrong sample rate, stereo output, duration drift, or internal silent gaps.

### Status

- Fixed locally; full production verification is recorded with the implementation commit.

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

## 2026-08-11 - H.264 export treated reordered PTS as regressing DTS

### Symptom

MP4 export failed with `Timestamps must be monotonically increasing (DTS went from 441179 to 394739)`.

### Root cause

Chrome's H.264 encoder may emit B frames in decode order while `EncodedVideoChunk.timestamp` remains the presentation timestamp. A presentation timestamp can legitimately move backward. Passing that value directly to mp4-muxer makes it interpret PTS as DTS and reject the fifth sample.

### Fix

- Added one `createMp4VideoChunkWriter()` boundary for the MP4 encoder callback.
- Generate a strictly increasing decode timeline from output order.
- Preserve the encoder PTS and pass `compositionTimeOffset = PTS - DTS` to mp4-muxer.
- Keep WebM behavior unchanged because its muxer contract differs.

### Regression coverage

- The exact `441179 -> 394739` sequence is tested through the writer boundary.
- A real mp4-muxer `addVideoChunkRaw()` regression verifies that the mapped sequence no longer throws.

### Status

- Fixed and verified locally.

## 2026-08-11 - AAC callback order still produced regressing MP4 DTS

### Symptom

After the H.264 timestamp fix, MP4 export could still fail with `Timestamps must be monotonically increasing (DTS went from 405333 to 362667)`.

### Root cause

The second sequence is audio, not video: at 48 kHz, AAC input is encoded in 1024-sample blocks, or about `21,333us` per block. Chrome delivered encoded AAC callbacks out of presentation order, and the audio callback passed each chunk directly to mp4-muxer. The muxer therefore rejected the lower audio DTS even though the video track was already normalized.

### Fix

- Buffer MP4 AAC output until `AudioEncoder.flush()` completes.
- Stable-sort chunks by their source timestamp before muxing.
- Normalize duplicate timestamps to a strictly increasing audio timeline.
- Keep WebM audio streaming unchanged.

### Regression coverage

- The exact `405333 -> 362667` callback sequence now verifies sorted, strictly increasing mux timestamps.
- The existing H.264 reordered-PTS and real mp4-muxer regressions remain active so both tracks are covered independently.

### Status

- Fixed and verified locally.

## 2026-08-12 - Generated key points used the interface language

### Symptom

Chinese subtitles could generate English key-point motion when the export page was open in English, and English subtitles could be forced through Chinese phrase validation on the Chinese page.

### Root cause

The export route locale was passed directly into the DeepSeek prompt, response parser, and local fallback. Subtitle content was never treated as the language source of truth.

### Fix

- Resolve one dominant language from all validated subtitle cues.
- Use the resolved language for remote generation, response validation, task metadata, and local fallback.
- Recompute it inside the API instead of trusting the client hint.
- Keep the UI locale only as a fallback for captions without meaningful Chinese or English text.

### Regression coverage

- English UI plus Chinese captions must produce Chinese output constraints and Chinese local key points.
- Chinese UI plus English captions must produce English output constraints and English local key points.
- Mixed captions use one dominant language for the complete track.

### Status

- Fixed and verified locally.

## 2026-08-11 - Dragged clip order reverted during persistence and reload

### Symptom

Moving split clips could appear correct in memory but restore chronological source order after persistence, reload, preview normalization, or export.

### Root cause

- `updateRecordingSegments()` sorted every saved array by `start`.
- `normalizeSegments()` also sorted and merged adjacent split clips, erasing the edit decision boundary.
- Timeline geometry was based only on source-time positions rather than output sequence positions.

### Fix

- Preserve the segment array as the authoritative playback sequence.
- Introduce order-preserving normalization for editor load, preview, and export.
- Render draggable clips on a ripple output timeline and keep source ranges immutable.
- Map screen frames and audio through the same ordered sequence.

### Regression coverage

- Domain tests verify split-boundary preservation and source/output time mapping after reorder.
- Chromium E2E creates three clips through the real Split action, drags the first to the end, and verifies the persisted IndexedDB order.

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

## 2026-08-13 - Recording made network activity appear unusably slow

### Symptom

High-quality desktop recording made unrelated web activity feel severely bandwidth constrained even though recording media was intended to remain local.

### Root cause

- A 4K/60 display stream can locally produce up to the existing 90 Mbps recording budget, creating continuous encoding, memory-copy, and IndexedDB write pressure in the browser process.
- Payment polling, analytics, route prefetch, and Excalidraw hover prewarming could still start during capture and compete for CPU, disk, and network scheduling.
- The application had no evidence boundary separating MediaRecorder byte production from actual WAN transfer, so local throughput was easily mistaken for uploaded traffic.
- The earlier Goodall experiment also cancelled running local media tasks and synchronously awaited diagnostics during stop, which would have introduced task regressions and slower export-page navigation.

### Fix

- Keep all existing quality and bitrate settings unchanged.
- Defer only noncritical, voluntary background work during capture; do not cancel active media tasks.
- Preserve accepted recorder chunks in ordered batches and expose pending/persisted write metrics.
- Store an aggregate local report that distinguishes actual WAN bytes from local media and IndexedDB throughput.
- Run storage-estimate diagnostics outside the stop-to-export critical path and exclude post-recording deferred requests from the recording interval.

### Regression coverage

- Slow IndexedDB writes retain all chunks in order and expose high/critical pressure.
- The resource gate is reference counted and resumes voluntary work without polling.
- Diagnostic serialization contains aggregate bytes but no URLs or media.
- The current 48 kHz / 128 kbps microphone quality baseline remains unchanged.

### Status

- Fixed and verified locally.

## 2026-08-12 - Voice repair existed as a disconnected prototype

### Symptom

The approved voice-repair controls lived on a standalone prototype route, so users could not apply them to the recording currently open in the export editor.

### Root cause

The prototype intentionally isolated all state in memory and had no connection to recording media, derived tracks, the task coordinator, preview audio, Timeline, or export configuration.

### Fix

- Place the entry in the Advanced editor toolbar and render the controls inside the existing right settings column.
- Connect diagnosis and processing to the recording microphone track and save a reversible derived audio track.
- Route processing through the unified task center and bind the selected track to both preview and final export.
- Remove the standalone prototype route to prevent a second export-editor experience from remaining in the product.

### Regression coverage

- E2E verifies the action appears only in the Advanced row, provides a prerequisite guide without microphone audio, and opens inside the existing export side panel.
- Domain tests cover presets, normalization, settings fingerprints, and stable diagnosis severity.

### Post-verification hardening

- A/B switching now reuses a repair track only when its complete settings fingerprint matches the current controls.
- Restoring original audio clears both denoise and voice-repair task state, preventing stale repair errors or progress from surviving the switch.
- The complete audio interaction E2E verifies Standard and Enhanced denoise remain functional before applying a Clear Voice repair track, and that preview, persistence, and both Timeline audio lanes select the repair result.

### Status

- Fixed and verified locally.
## 2026-08-13 - Preview froze behind audio and export failed on valid peaks

### Symptoms

- Preview audio advanced while the canvas stayed on old frames or updated in bursts, making long recordings impractical to edit.
- Some ratios, including 3:2, failed with `export_audio_clipped_samples` even though ratio selection does not alter audio.
- A late browser audio-encoder failure could discard a completed hardware video pass and start a much slower full ffmpeg software export.

### Root cause

- Every playback tick aborted the in-flight preview composition, so a renderer slower than the 50-100ms request interval could be prevented from ever publishing a frame.
- Playback used `performance.now()` while audio, camera, and display sources advanced on independent media clocks, and propagated the playhead through React at animation-frame frequency.
- Audio continuity validation treated any decoded Float32 sample above `1.0` as fatal rather than applying one transparent track-level gain.
- Audio encoding happened after all video frames and shared the same broad WebCodecs fallback classification as video failures.

### Fix

- Complete the active playback frame and coalesce only waiting requests; precise scrub still aborts obsolete renders.
- Follow the audio media clock within a bounded drift window, tighten camera/display correction, throttle parent playhead publishing, and reuse large preview canvases.
- Normalize the complete track to `-1 dBFS` only when its original peak exceeds full scale; non-finite samples remain fatal.
- Encode audio concurrently, choose an A/V or video-only muxer before streaming the main video pass, and use audio-only remux after audio encoder failure.

### Regression coverage

- Added runner scheduling, audio-clock drift, peak normalization, direct-audio fallback, AAC continuity, H.264 timestamp, and real muxer coverage.
- Full focused suite: 71 tests passed.

### Status

- Fixed and verified locally.
