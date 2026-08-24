# macOS Desktop Full-Story E2E Contract

This document defines the release gate for the macOS teaching recorder. Unit,
contract, renderer-only, helper-only, and mocked bridge tests do not satisfy
this gate by themselves.

## Gate A: automated packaged-app story

The test launches the packaged Electron application with a repository-matched
renderer and the packaged native helper. It must not replace the preload bridge
or helper client with an in-page mock.

The story must verify, in order:

1. The application and helper handshake successfully and expose compatible
   contract versions.
2. A main-owned project is created with screen, microphone, system-audio, and
   camera tracks plus the selected teaching-recipe snapshot.
3. Excalidraw ink, cursor/click telemetry, camera controls, pause/resume, and
   teleprompter progress use one pause-compacted project clock.
4. Stop drains telemetry and media writers before publishing the capture
   manifest. No upload, ASR, export, or other heavy job runs during capture.
5. Director and teaching-composition jobs consume the durable recording and
   publish explicit `ready`, `unsupported`, or `failed` states. Selected
   capabilities may not silently fall back to a plain recording.
6. The final-render job consumes main-owned immutable inputs, produces a
   validated MP4, and publishes only an identity, checksum, byte length, and
   duration to the renderer.
7. Preview seeks through the restricted Range protocol. Saving the output is a
   main-process streaming copy and never constructs a renderer-sized Blob.
8. After force-closing and reopening the application, the project, teaching
   state, final-render state, preview seek, and saved-output identity recover
   without rerunning completed work.

Required assertions include A/V duration and start-time alignment, a decoded
frame after every cut boundary, audible microphone and system-audio markers,
camera visibility transitions, ink/event ordering, bounded file-descriptor and
resident-memory growth, and zero orphan `recording`, `final`, or staging files.

## Gate B: target-Mac signed-DMG story

This gate runs on a supported Apple-silicon Mac using the signed, notarized,
stapled DMG downloaded from the same GitHub prerelease exposed by the Web
download endpoint.

The operator grants Screen Recording, Microphone, Camera, and Input Monitoring
to the installed application. The test records a real display or window with:

- microphone and computer audio enabled;
- camera enabled and visibly active;
- transparent Excalidraw overlay;
- notch teleprompter in smart read-along mode;
- pause/resume, microphone mute, system-audio mute, and camera off/on;
- at least one selected teaching sound effect and one explicitly supported
  visual teaching asset.

The resulting project must complete the same Director, composition, final
render, preview, save, and restart-recovery story as Gate A.

## Soak and pressure variant

The target-Mac story is repeated for 60 minutes at 1440p30 with microphone,
system audio, and 720p camera while a large local copy and network download run.
Release acceptance requires:

- no linear resident-memory or file-descriptor growth;
- no audio gaps and no timestamp discontinuities;
- main-thread event-loop p95 below 50 ms;
- no unbounded encoder, telemetry, writer, or media-job queue;
- network and local-copy throughput at least 70% of the idle baseline;
- stop reaches the editor within three seconds;
- the final MP4 is seekable, recoverable, and saves successfully;
- a new capture preempts and fully drains post-capture work before recording.

## Required evidence

Each release archives:

- the DMG and `SHA256SUMS.txt`;
- signing, notarization, staple, and Gatekeeper verification logs;
- the exact Git commit, renderer URL/build identity, helper handshake, and
  recording/final-render manifest identities;
- automated Gate A traces and screenshots;
- Gate B permission screenshots and the final saved MP4 checksum;
- soak time-series for RSS, file descriptors, queue depths, event-loop delay,
  disk throughput, and network throughput.

No release may be described as full-story verified while either gate is skipped
or while a requested module is represented by a fake, a renderer-only fixture,
or a silent fallback.
