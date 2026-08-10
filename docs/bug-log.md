# Bug Log

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
