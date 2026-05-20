# Screen Record P1 — Core Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core screen-recording pipeline end-to-end: user picks a source via system picker, records with mic + camera bubble live-composited, lands on a processing page, downloads an MP4 (with frosted-glass watermark for Free / clean for Pro). No aspect picker, no teleprompter, no subtitles yet — those are P2/P3/P4.

**Architecture:** `getDisplayMedia` → OffscreenCanvas live composite (display + camera bubble + audio mixer via AudioContext) → `canvas.captureStream()` → MediaRecorder → IndexedDB chunks. At download: ffmpeg.wasm transcodes webm → MP4 + overlays watermark (Free) or skips it (Pro). **The recorded webm is always clean; watermark is added only at download time** so Pro upgrade retroactively removes watermark from old recordings without re-recording.

**Tech Stack:** Next.js App Router, TypeScript, IndexedDB (Dexie), MediaRecorder API, AudioContext, OffscreenCanvas, ffmpeg.wasm 0.12. Worktree: `.worktrees/screen-record` on branch `feature/screen-record`.

---

## Hard Invariants (do not violate)

1. **Watermark is NEVER baked into the recorded webm.** It's overlaid by ffmpeg only at download time, decided by the *current* Pro status. So a Free user who upgrades after recording can re-download the same recording without watermark.
2. **No data leaves the browser.** No cloud sync. No backend storage. The only server-side touch is the existing DashScope ASR proxy (P4 territory, not in P1).
3. **Old scene-replay recordings stay playable.** Existing IndexedDB tables (`recordings` v1–v5) and `/play/[id]` / `/export/[id]` keep working.
4. **No `selfBrowserSurface` exclusion in P1.** User picks any source from the system picker, including the Excalicast tab itself. (Teleprompter isolation is a P3 concern.)

---

## File Map

**New files**

| Path | Responsibility |
|---|---|
| `src/types/screenRecording.ts` | New types: `ScreenRecordingMetadata`, `ScreenRecordingChunk`, `RecordingKind` |
| `src/services/displayCapture.ts` | Thin wrapper: `getDisplayMedia` + optional `getUserMedia` for system audio fallback |
| `src/services/liveComposite.ts` | OffscreenCanvas-based composite (display + camera bubble) + AudioContext mixer + `canvas.captureStream()` |
| `src/services/screenRecording.ts` | Orchestrator: `startScreenRecording`, `pause`, `resume`, `stop` returning `ScreenRecordingMetadata` |
| `src/services/screenExport.ts` | ffmpeg.wasm: webm chunks → MP4 + optional watermark overlay |
| `src/utils/screenWatermarkFilter.ts` | Builds the ffmpeg `-filter_complex` string for the frosted-glass `excalicast.cc` watermark |
| `src/components/RecordSetupModal.tsx` | Pre-record toggles: mic / system audio / camera bubble |
| `src/components/ScreenRecordingBar.tsx` | Floating record control: timer + pause/resume/stop + camera bubble drag |
| `src/components/CameraBubblePreview.tsx` | Reused-ish camera bubble preview (CSS-rendered for user preview only; ffmpeg-side composite is done by `liveComposite.ts`) |
| `src/app/[locale]/process/[id]/page.tsx` | Post-record page: native `<video>` player + Download MP4 button |
| `public/fonts/watermark-latin.ttf` | Inter Regular (Latin subset, ~30KB) — ffmpeg drawtext needs a font file |
| `supabase/migrations/20260520_drop_recordings_cloud.sql` | Drop cloud sync schema (table + bucket policies) |

**Modified files**

| Path | Why |
|---|---|
| `src/lib/db-client.ts` | Add IndexedDB v6: tables `screenRecordings` + `screenChunks`. Helpers: `appendScreenChunk`, `getScreenRecording`, `listScreenRecordings`, `loadScreenRecordingWebm`, `deleteScreenRecording` |
| `src/types/recording.ts` | Re-export `RecordingKind` + add union type for library list |
| `src/app/[locale]/app/page.tsx` | Replace existing scene-replay record entry with new RecordSetupModal entry. Old code path stays in-place but is unreachable from this page |
| `src/components/RecordingsList.tsx` | Union local list: scene-replay rows + screen-record rows; click routes to `/play/[id]` (old) vs `/process/[id]` (new) |
| `CLAUDE.md` | Reverse `getDisplayMedia` ban; add new product-level constraints (no cloud sync, watermark at download time only) |

**Deleted files** (cleanup of dead-after-refactor code)

| Path | Why dead |
|---|---|
| `src/services/cloudSync.ts` | No cloud sync any more |
| `src/services/workspaceShellCapture.ts` | Screen recording captures the workspace UI natively |
| `src/components/WorkspaceShellToggle.tsx` | Same |
| `src/app/api/recordings/register/route.ts` | No cloud sync |
| `src/app/api/recordings/list/route.ts` | Same |
| `src/app/api/recordings/[id]/route.ts` | Same |

---

## Task 0: Pre-flight

**Files:** none (env check)

- [ ] **Step 0.1: Verify worktree + branch**

```bash
pwd
git rev-parse --abbrev-ref HEAD
```

Expected: `/Users/chenzhijiang/.claude/projects/excalicast/.worktrees/screen-record` and `feature/screen-record`.

- [ ] **Step 0.2: Ensure deps are installed**

```bash
npm install
```

If `node_modules` does not exist, this populates it. Should be fast on first install.

- [ ] **Step 0.3: Baseline typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no output (clean). If errors appear, they're pre-existing and need fixing before continuing — pause and triage.

---

## Task 1: Add the watermark font

**Files:**
- Create: `public/fonts/watermark-latin.ttf`

ffmpeg.wasm's `drawtext` filter requires a TTF file inside its virtual FS. The text we draw is `excalicast.cc` — pure Latin, so a small Latin-subset TTF (~30KB) suffices.

- [ ] **Step 1.1: Download Inter Regular (Latin subset)**

```bash
curl -L -o public/fonts/watermark-latin.ttf \
  https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.otf
```

If the URL fails or you prefer a different family, any free Latin TTF/OTF works. Verify the file is non-empty:

```bash
ls -la public/fonts/watermark-latin.ttf
file public/fonts/watermark-latin.ttf
```

Expected: file size > 10KB, `file` reports `TrueType Font` or `OpenType Font`.

- [ ] **Step 1.2: Commit**

```bash
git add public/fonts/watermark-latin.ttf
git commit -m "feat(p1): add Inter Latin TTF for ffmpeg drawtext watermark"
```

---

## Task 2: Type definitions

**Files:**
- Create: `src/types/screenRecording.ts`
- Modify: `src/types/recording.ts` (re-export `RecordingKind`)

- [ ] **Step 2.1: Create `src/types/screenRecording.ts`**

```typescript
export type RecordingKind = 'scene_replay' | 'screen_capture';

export type RecordingStatus = 'recording' | 'done' | 'error';

export interface ScreenRecordingMetadata {
  id: string;
  kind: 'screen_capture';
  startedAt: number;        // Unix ms
  durationMs: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string;       // base64 data URL, generated at stop
  status: RecordingStatus;
  title?: string;
  // The recorded webm is the union of all `screenChunks` rows ordered by `index`.
  // We do NOT store the watermark state here — watermark is decided at download.
}

export interface ScreenRecordingChunk {
  id?: number;              // dexie auto-pk
  recordingId: string;
  index: number;            // ordering
  blob: Blob;               // ~1s webm slice
}
```

- [ ] **Step 2.2: Re-export from `src/types/recording.ts`**

Append to the existing file (do not delete or refactor existing types):

```typescript
// Screen-capture types — separate file to keep the old scene-replay types isolated.
export type { RecordingKind, RecordingStatus, ScreenRecordingMetadata, ScreenRecordingChunk } from './screenRecording';
```

- [ ] **Step 2.3: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/types/screenRecording.ts src/types/recording.ts
git commit -m "feat(p1): add ScreenRecording* types"
```

---

## Task 3: IndexedDB schema v6 + helpers

**Files:**
- Modify: `src/lib/db-client.ts`

- [ ] **Step 3.1: Add tables to the Dexie class**

Find the existing `class ExcalicastDB extends Dexie` declaration. Add a new table:

```typescript
import type { ScreenRecordingMetadata, ScreenRecordingChunk } from '@/types/recording';

interface ScreenChunkRow extends ScreenRecordingChunk {
  id?: number;
}

class ExcalicastDB extends Dexie {
  // ...existing tables unchanged...
  screenRecordings!: Table<ScreenRecordingMetadata, string>;
  screenChunks!: Table<ScreenChunkRow, number>;

  constructor() {
    super('excalicast');
    // ...existing this.version(1)..this.version(5) unchanged...

    // v6: new tables for screen-capture recordings; old tables untouched.
    this.version(6).stores({
      recordings: 'id, startedAt, status',
      snapshots: '++id, recordingId, timestamp',
      audioChunks: '++id, recordingId, index',
      cameraChunks: '++id, recordingId, index',
      binaryFiles: '++id, recordingId, fileId',
      workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
      screenRecordings: 'id, startedAt, status',
      screenChunks: '++id, recordingId, index, [recordingId+index]',
    });
  }
}
```

- [ ] **Step 3.2: Add helper functions at end of `src/lib/db-client.ts`**

```typescript
export async function appendScreenChunk(row: ScreenRecordingChunk): Promise<void> {
  await getClientDb().screenChunks.add(row);
}

export async function listScreenRecordings(): Promise<ScreenRecordingMetadata[]> {
  return getClientDb().screenRecordings
    .orderBy('startedAt')
    .reverse()
    .toArray();
}

export async function getScreenRecording(id: string): Promise<ScreenRecordingMetadata | undefined> {
  return getClientDb().screenRecordings.get(id);
}

export async function putScreenRecording(meta: ScreenRecordingMetadata): Promise<void> {
  await getClientDb().screenRecordings.put(meta);
}

export async function updateScreenRecording(
  id: string,
  patch: Partial<ScreenRecordingMetadata>,
): Promise<void> {
  await getClientDb().screenRecordings.update(id, patch);
}

export async function loadScreenRecordingWebm(id: string): Promise<Blob> {
  const chunks = await getClientDb().screenChunks
    .where('recordingId').equals(id)
    .sortBy('index');
  if (chunks.length === 0) throw new Error(`no_chunks_for_${id}`);
  return new Blob(chunks.map((c) => c.blob), { type: chunks[0].blob.type || 'video/webm' });
}

export async function deleteScreenRecording(id: string): Promise<void> {
  const db = getClientDb();
  await db.transaction('rw', [db.screenRecordings, db.screenChunks], async () => {
    await db.screenRecordings.delete(id);
    await db.screenChunks.where('recordingId').equals(id).delete();
  });
}
```

- [ ] **Step 3.3: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.4: Smoke-test the schema upgrade in the browser**

```bash
npm run dev
```

Open `http://localhost:3001/` in Chrome, then in DevTools console run:

```javascript
(async () => {
  const Dexie = (await import('https://cdn.jsdelivr.net/npm/dexie@4/+esm')).default;
  const db = new Dexie('excalicast');
  await db.open();
  console.log('version:', db.verno);  // expect 6
  console.log('tables:', db.tables.map(t => t.name).sort());
  await db.close();
})();
```

Expected output includes `screenChunks` and `screenRecordings` in the table list, and `version: 6`. Stop the dev server (`Ctrl-C`).

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/db-client.ts
git commit -m "feat(p1): IndexedDB schema v6 — screen-record tables + helpers"
```

---

## Task 4: displayCapture service

**Files:**
- Create: `src/services/displayCapture.ts`

- [ ] **Step 4.1: Create the file**

```typescript
'use client';

export interface DisplayCaptureRequest {
  withSystemAudio: boolean;
}

export interface DisplayCaptureResult {
  videoStream: MediaStream;       // 1 video track from the display
  systemAudioTrack: MediaStreamTrack | null;
  // When user picks 'window' or denies sysAudio, this is null; UI should fall back gracefully.
}

/**
 * Trigger the system picker. The user chooses tab / window / screen.
 * Returns the resulting video stream + an optional system-audio track.
 *
 * Throws if the user denies / cancels.
 */
export async function captureDisplay(req: DisplayCaptureRequest): Promise<DisplayCaptureResult> {
  const constraints: DisplayMediaStreamOptions = {
    video: {
      // Hint Chrome to prefer browser-tab capture, but the user can still pick anything.
      // @ts-expect-error displaySurface is in the spec but not in all TS lib versions
      displaySurface: 'browser',
      frameRate: { ideal: 30, max: 60 },
    },
    audio: req.withSystemAudio,
  };

  // @ts-expect-error getDisplayMedia type in lib.dom is sometimes narrower than the spec
  const stream: MediaStream = await navigator.mediaDevices.getDisplayMedia(constraints);

  // Split: keep video track in result.videoStream, extract sysAudio if present.
  const videoTracks = stream.getVideoTracks();
  const audioTracks = stream.getAudioTracks();

  // Always rebuild the video stream so the caller can attach lifecycle handlers consistently.
  const videoStream = new MediaStream(videoTracks);
  const systemAudioTrack = audioTracks[0] ?? null;

  return { videoStream, systemAudioTrack };
}

/**
 * Get the microphone stream. Independent of display capture.
 * Returns null if mic is disabled by user (not denied — disabled in setup modal).
 */
export async function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48000,    // sysAudio is typically 48k — match for clean mixing
      channelCount: 1,
    },
    video: false,
  });
}

/**
 * Get the camera stream. Independent of display capture.
 * Returns null if camera is disabled.
 */
export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 640 },
      height: { ideal: 640 },
      facingMode: 'user',
    },
  });
}
```

- [ ] **Step 4.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/services/displayCapture.ts
git commit -m "feat(p1): displayCapture service — getDisplayMedia + mic + camera wrappers"
```

---

## Task 5: liveComposite service

**Files:**
- Create: `src/services/liveComposite.ts`

The live composite draws every frame from the display stream into an OffscreenCanvas, then overlays the camera circle. `canvas.captureStream()` produces the MediaRecorder-fed video track. Audio tracks (mic + optional system) are merged through AudioContext.

- [ ] **Step 5.1: Create the file**

```typescript
'use client';

export interface CompositeInputs {
  displayStream: MediaStream;
  cameraStream: MediaStream | null;
  micStream: MediaStream | null;
  systemAudioTrack: MediaStreamTrack | null;
}

export interface CompositeOutput {
  outputStream: MediaStream;
  output: { width: number; height: number };
  setCameraPosition: (pos: { x: number; y: number }) => void;
  stop: () => void;
}

export interface CompositeOptions {
  fps: number;                       // 30
  cameraSizePx: number;              // diameter; default 160
  initialCameraPosition: { x: number; y: number };
}

/**
 * Build a single output MediaStream that mixes:
 *   - display video (drawn into canvas)
 *   - camera bubble (drawn on top, circular crop)
 *   - mic + optional system audio (mixed via AudioContext)
 */
export function startLiveComposite(
  inputs: CompositeInputs,
  opts: CompositeOptions,
): CompositeOutput {
  const displayVideo = document.createElement('video');
  displayVideo.srcObject = inputs.displayStream;
  displayVideo.muted = true;
  void displayVideo.play();

  const cameraVideo = inputs.cameraStream ? document.createElement('video') : null;
  if (cameraVideo) {
    cameraVideo.srcObject = inputs.cameraStream;
    cameraVideo.muted = true;
    void cameraVideo.play();
  }

  // Wait one tick for the display track to negotiate its actual resolution.
  // (settings may report nominal dims; on Chrome they update after first frame.)
  const settings = inputs.displayStream.getVideoTracks()[0].getSettings();
  const W = settings.width ?? 1920;
  const H = settings.height ?? 1080;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_2d_unavailable');

  let cameraX = opts.initialCameraPosition.x;
  let cameraY = opts.initialCameraPosition.y;

  let running = true;
  const drawFrame = () => {
    if (!running) return;
    if (displayVideo.readyState >= 2) {
      ctx.drawImage(displayVideo, 0, 0, W, H);
    }
    if (cameraVideo && cameraVideo.readyState >= 2) {
      const r = opts.cameraSizePx / 2;
      ctx.save();
      // mirror horizontally to match user expectation
      ctx.beginPath();
      ctx.arc(cameraX + r, cameraY + r, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(cameraX + r, cameraY + r);
      ctx.scale(-1, 1);
      ctx.translate(-(cameraX + r), -(cameraY + r));
      ctx.drawImage(cameraVideo, cameraX, cameraY, opts.cameraSizePx, opts.cameraSizePx);
      ctx.restore();
      // ring stroke
      ctx.beginPath();
      ctx.arc(cameraX + r, cameraY + r, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
    requestAnimationFrame(drawFrame);
  };
  requestAnimationFrame(drawFrame);

  const videoTrack = (canvas as HTMLCanvasElement).captureStream(opts.fps).getVideoTracks()[0];

  // Audio mix
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  if (inputs.micStream) {
    audioCtx.createMediaStreamSource(inputs.micStream).connect(dest);
  }
  if (inputs.systemAudioTrack) {
    const sysStream = new MediaStream([inputs.systemAudioTrack]);
    audioCtx.createMediaStreamSource(sysStream).connect(dest);
  }

  const outputStream = new MediaStream([
    videoTrack,
    ...dest.stream.getAudioTracks(),
  ]);

  return {
    outputStream,
    output: { width: W, height: H },
    setCameraPosition: (pos) => {
      cameraX = pos.x;
      cameraY = pos.y;
    },
    stop: () => {
      running = false;
      videoTrack.stop();
      try { audioCtx.close(); } catch { /* ignore */ }
      try { inputs.displayStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.cameraStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      try { inputs.systemAudioTrack?.stop(); } catch { /* */ }
    },
  };
}
```

- [ ] **Step 5.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/services/liveComposite.ts
git commit -m "feat(p1): liveComposite service — canvas + camera bubble + audio mixer"
```

---

## Task 6: screenRecording orchestrator

**Files:**
- Create: `src/services/screenRecording.ts`

- [ ] **Step 6.1: Create the file**

```typescript
'use client';

import { v4 as uuidv4 } from 'uuid';
import { appendScreenChunk, putScreenRecording, updateScreenRecording } from '@/lib/db-client';
import { captureCamera, captureDisplay, captureMicrophone } from '@/services/displayCapture';
import { startLiveComposite, type CompositeOutput } from '@/services/liveComposite';
import type { ScreenRecordingMetadata } from '@/types/recording';

export interface StartScreenRecordingOpts {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
  initialCameraPosition: { x: number; y: number };
  cameraSizePx: number;          // 160
}

export interface ScreenRecordingHandle {
  recordingId: string;
  startedAt: number;
  output: { width: number; height: number };
  hasMic: boolean;
  hasSystemAudio: boolean;
  hasCamera: boolean;
  /** for live preview UI */
  cameraStream: MediaStream | null;
  setCameraPosition: (pos: { x: number; y: number }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<ScreenRecordingMetadata>;
  getElapsedMs: () => number;
}

const CHUNK_INTERVAL_MS = 1000;
const RECORDER_MIME = 'video/webm;codecs=vp9,opus';

export async function startScreenRecording(opts: StartScreenRecordingOpts): Promise<ScreenRecordingHandle> {
  const recordingId = uuidv4();
  const startedAt = Date.now();

  // 1) Display
  const { videoStream: displayStream, systemAudioTrack } = await captureDisplay({
    withSystemAudio: opts.withSystemAudio,
  });
  const hasSystemAudio = systemAudioTrack !== null;

  // If user denied or picked a source that doesn't expose system audio,
  // hasSystemAudio is false even when user opted in — UI should reflect this.

  // 2) Mic
  let micStream: MediaStream | null = null;
  let hasMic = false;
  if (opts.withMic) {
    try {
      micStream = await captureMicrophone();
      hasMic = true;
    } catch (err) {
      // Mic permission denied — degrade gracefully
      console.warn('mic_failed', err);
    }
  }

  // 3) Camera
  let cameraStream: MediaStream | null = null;
  let hasCamera = false;
  if (opts.withCamera) {
    try {
      cameraStream = await captureCamera();
      hasCamera = true;
    } catch (err) {
      console.warn('camera_failed', err);
    }
  }

  // 4) Composite
  const composite: CompositeOutput = startLiveComposite(
    {
      displayStream,
      cameraStream,
      micStream,
      systemAudioTrack,
    },
    {
      fps: 30,
      cameraSizePx: opts.cameraSizePx,
      initialCameraPosition: opts.initialCameraPosition,
    },
  );

  // 5) Persist initial metadata
  await putScreenRecording({
    id: recordingId,
    kind: 'screen_capture',
    startedAt,
    durationMs: 0,
    output: composite.output,
    hasMic,
    hasSystemAudio,
    hasCamera,
    status: 'recording',
  });

  // 6) MediaRecorder
  const recorder = new MediaRecorder(composite.outputStream, {
    mimeType: RECORDER_MIME,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  });

  let chunkIndex = 0;
  recorder.ondataavailable = async (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      await appendScreenChunk({
        recordingId,
        index: chunkIndex++,
        blob: e.data,
      });
    }
  };

  let paused = false;
  let pauseStartedAt = 0;
  let pausedTotal = 0;
  recorder.start(CHUNK_INTERVAL_MS);

  // Auto-stop if user kills the display stream from the browser UI
  displayStream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder.state !== 'inactive') {
      void stopInternal();
    }
  });

  const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pauseStartedAt : 0);

  const stopInternal = async (): Promise<ScreenRecordingMetadata> => {
    if (paused) {
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    }
    // Flush + wait for the final ondataavailable
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') return resolve();
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    composite.stop();

    const durationMs = elapsed();
    const meta: Partial<ScreenRecordingMetadata> = { durationMs, status: 'done' };
    await updateScreenRecording(recordingId, meta);
    const stored = (await import('@/lib/db-client')).getScreenRecording(recordingId);
    const final = await stored;
    if (!final) throw new Error('recording_lost_after_stop');
    return final;
  };

  return {
    recordingId,
    startedAt,
    output: composite.output,
    hasMic,
    hasSystemAudio,
    hasCamera,
    cameraStream,
    setCameraPosition: composite.setCameraPosition,
    getElapsedMs: elapsed,
    pause: () => {
      if (paused) return;
      recorder.pause();
      paused = true;
      pauseStartedAt = Date.now();
    },
    resume: () => {
      if (!paused) return;
      recorder.resume();
      pausedTotal += Date.now() - pauseStartedAt;
      paused = false;
    },
    stop: stopInternal,
  };
}
```

- [ ] **Step 6.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/services/screenRecording.ts
git commit -m "feat(p1): screenRecording orchestrator — start / pause / resume / stop"
```

---

## Task 7: RecordSetupModal component

**Files:**
- Create: `src/components/RecordSetupModal.tsx`

P1 keeps it minimal: just the three toggles. Aspect ratio + crop region come in P2.

- [ ] **Step 7.1: Create the file**

```typescript
'use client';

import { useState } from 'react';
import { I } from '@/components/icons';

export interface RecordSetupValues {
  withMic: boolean;
  withSystemAudio: boolean;
  withCamera: boolean;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (values: RecordSetupValues) => void;
}

export function RecordSetupModal({ open, onCancel, onConfirm }: Props): JSX.Element | null {
  const [withMic, setWithMic] = useState(true);
  const [withSystemAudio, setWithSystemAudio] = useState(false);
  const [withCamera, setWithCamera] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-2xl bg-bg-primary p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[18px] font-bold text-text-primary">开始录制</h2>

        <Toggle label="麦克风" desc="录入你说的话" checked={withMic} onChange={setWithMic} />
        <Toggle
          label="系统音频"
          desc="录入网页 / 应用的声音（仅当选「整个屏幕」或某个标签页有声音时生效）"
          checked={withSystemAudio}
          onChange={setWithSystemAudio}
        />
        <Toggle
          label="摄像头气泡"
          desc="圆形头像浮在屏幕右下角"
          checked={withCamera}
          onChange={setWithCamera}
        />

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-default px-4 py-2 text-[13px] font-semibold text-text-secondary hover:bg-bg-tertiary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ withMic, withSystemAudio, withCamera })}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'var(--recording-strong)' }}
          >
            <span className="h-2 w-2 rounded-full bg-white" />
            选择录制源
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`mt-3 flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
        checked
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-bg-primary hover:bg-bg-tertiary'
      }`}
    >
      <span
        className="mt-1 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-md border-2"
        style={{ borderColor: checked ? 'var(--primary-600)' : 'var(--border-strong)' }}
      >
        {checked && <I.Check size={12} sw={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-text-primary">{label}</div>
        <div className="mt-0.5 text-[11.5px] text-text-tertiary">{desc}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 7.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/components/RecordSetupModal.tsx
git commit -m "feat(p1): RecordSetupModal — mic / sysAudio / camera toggles"
```

---

## Task 8: ScreenRecordingBar component

**Files:**
- Create: `src/components/ScreenRecordingBar.tsx`

Simple floating bar visible during recording. Pause/resume/stop, live timer, and a "discard" button.

- [ ] **Step 8.1: Create the file**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { I } from '@/components/icons';

export interface ScreenRecordingBarProps {
  state: 'recording' | 'paused';
  getElapsedMs: () => number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function ScreenRecordingBar({
  state,
  getElapsedMs,
  onPause,
  onResume,
  onStop,
  onDiscard,
}: ScreenRecordingBarProps): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setElapsed(getElapsedMs()), 250);
    return () => clearInterval(id);
  }, [state, getElapsedMs]);

  return (
    <div
      className="flex items-center gap-2 rounded-full bg-black/85 px-4 py-2 text-white shadow-2xl"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <span
        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          state === 'recording' ? 'animate-pulse bg-recording-strong' : 'bg-yellow-400'
        }`}
      />
      <span className="font-mono text-[13px] tabular-nums">{fmt(elapsed)}</span>
      <div className="mx-2 h-4 w-px bg-white/25" />
      {state === 'recording' ? (
        <button
          type="button"
          onClick={onPause}
          className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
          aria-label="暂停"
        >
          <I.Pause size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
          aria-label="继续"
        >
          <I.Play size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        className="grid h-7 w-7 place-items-center rounded-full bg-recording-strong hover:brightness-110"
        aria-label="停止"
      >
        <I.Stop size={12} />
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="ml-1 grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
        aria-label="丢弃"
        title="丢弃这次录制"
      >
        <I.Trash size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 8.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/components/ScreenRecordingBar.tsx
git commit -m "feat(p1): ScreenRecordingBar — pause / resume / stop / discard + timer"
```

---

## Task 9: Wire up workspace page

**Files:**
- Modify: `src/app/[locale]/app/page.tsx`

Replace the existing scene-replay record button + bar with the new screen-record flow. Keep the existing Whiteboard component (it's still useful for the "hybrid" positioning — users can draw on it before/during recording).

- [ ] **Step 9.1: Read the current page**

```bash
cat 'src/app/[locale]/app/page.tsx'
```

Identify the existing imports and the `handleStart` function. We're going to add a new code path next to (not replacing) the old one — the old `startRecording` from `recordingSession.ts` is dead code in P1 but we keep the import-site intact so we don't break old recordings.

- [ ] **Step 9.2: Add new imports + state to the workspace page**

Find the existing imports at the top of `src/app/[locale]/app/page.tsx`. Add:

```typescript
import { RecordSetupModal, type RecordSetupValues } from '@/components/RecordSetupModal';
import { ScreenRecordingBar } from '@/components/ScreenRecordingBar';
import { startScreenRecording, type ScreenRecordingHandle } from '@/services/screenRecording';
```

Add state (next to the existing useState calls):

```typescript
const [setupOpen, setSetupOpen] = useState(false);
const screenSessionRef = useRef<ScreenRecordingHandle | null>(null);
const [screenState, setScreenState] = useState<'idle' | 'recording' | 'paused' | 'processing'>('idle');
```

- [ ] **Step 9.3: Replace the existing "开始录制" button with one that opens RecordSetupModal**

Find the button in the JSX that previously called `handleStart`. Replace it with:

```tsx
<button
  type="button"
  onClick={() => setSetupOpen(true)}
  disabled={screenState !== 'idle'}
  className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-50"
  style={{ background: 'var(--recording-strong)' }}
>
  <span className="h-2 w-2 rounded-full bg-white" />
  开始录制
</button>
```

- [ ] **Step 9.4: Add the setup-modal + recording-bar to the JSX (next to the existing CameraBubble area)**

```tsx
<RecordSetupModal
  open={setupOpen}
  onCancel={() => setSetupOpen(false)}
  onConfirm={async (vals: RecordSetupValues) => {
    setSetupOpen(false);
    try {
      const handle = await startScreenRecording({
        withMic: vals.withMic,
        withSystemAudio: vals.withSystemAudio,
        withCamera: vals.withCamera,
        cameraSizePx: 160,
        initialCameraPosition: {
          x: window.innerWidth - 200,
          y: window.innerHeight - 200,
        },
      });
      screenSessionRef.current = handle;
      setScreenState('recording');
    } catch (err) {
      alert(`无法开始录制：${err instanceof Error ? err.message : 'unknown'}`);
    }
  }}
/>

{screenSessionRef.current && (screenState === 'recording' || screenState === 'paused') && (
  <div
    className="fixed left-1/2 z-40 -translate-x-1/2"
    style={{ bottom: 24 }}
  >
    <ScreenRecordingBar
      state={screenState as 'recording' | 'paused'}
      getElapsedMs={() => screenSessionRef.current!.getElapsedMs()}
      onPause={() => {
        screenSessionRef.current?.pause();
        setScreenState('paused');
      }}
      onResume={() => {
        screenSessionRef.current?.resume();
        setScreenState('recording');
      }}
      onStop={async () => {
        const handle = screenSessionRef.current;
        if (!handle) return;
        setScreenState('processing');
        const meta = await handle.stop();
        screenSessionRef.current = null;
        setScreenState('idle');
        router.push(`/process/${meta.id}` as never);
      }}
      onDiscard={async () => {
        if (!confirm('丢弃这次录制？')) return;
        const handle = screenSessionRef.current;
        if (!handle) return;
        const meta = await handle.stop();
        const { deleteScreenRecording } = await import('@/lib/db-client');
        await deleteScreenRecording(meta.id);
        screenSessionRef.current = null;
        setScreenState('idle');
      }}
    />
  </div>
)}
```

- [ ] **Step 9.5: Run typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

Expected: typecheck has no output; `next build` finishes with a green summary listing routes (no errors).

- [ ] **Step 9.6: Smoke test in dev**

```bash
npm run dev
```

In Chrome at `http://localhost:3001/zh/app`, open DevTools console (to watch for errors), then:

1. Click "开始录制"
2. Modal appears with three toggles
3. Click "选择录制源"
4. Chrome's picker pops up — select an open browser tab
5. Floating bar appears at the bottom with timer counting up
6. Click pause → state changes to paused
7. Click resume → counter continues
8. Click stop → page navigates to `/process/<id>` (will 404 until Task 10 — that's expected)

Stop the dev server.

- [ ] **Step 9.7: Commit**

```bash
git add 'src/app/[locale]/app/page.tsx'
git commit -m "feat(p1): wire RecordSetupModal + ScreenRecordingBar into workspace"
```

---

## Task 10: Process page (player + download placeholder)

**Files:**
- Create: `src/app/[locale]/process/[id]/page.tsx`

This page handles: loading the recording, building a Blob URL for the inline `<video>`, and exposing a Download MP4 button. Watermark / Pro flow is wired in Task 12.

- [ ] **Step 10.1: Create the page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { I } from '@/components/icons';
import { getScreenRecording, loadScreenRecordingWebm } from '@/lib/db-client';
import type { ScreenRecordingMetadata } from '@/types/recording';
import { Link } from '@/i18n/navigation';

export default function ProcessRecordingPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [meta, setMeta] = useState<ScreenRecordingMetadata | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let created: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const m = await getScreenRecording(id);
        if (!m) {
          if (!cancelled) setLoadError(`找不到录制：${id}`);
          return;
        }
        if (cancelled) return;
        setMeta(m);
        const blob = await loadScreenRecordingWebm(id);
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setVideoUrl(created);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center">
          <div className="rounded-md border border-border-default bg-bg-primary px-8 py-6 text-center">
            <p className="text-sm text-recording-strong">{loadError}</p>
            <Link href="/library" className="mt-3 inline-block text-xs text-primary-600 underline">
              返回录制库
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!meta || !videoUrl) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader tier="free" />
        <div className="grid flex-1 place-items-center text-sm text-text-tertiary">加载录制…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <AppHeader tier="free" />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto px-7 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-baseline gap-3">
              <Link
                href="/library"
                className="text-text-tertiary hover:text-text-primary"
                aria-label="返回"
              >
                <I.ChevronLeft size={18} />
              </Link>
              <h1 className="text-[22px] font-bold leading-tight">录制完成</h1>
              <span className="text-[12px] text-text-tertiary">
                {Math.round(meta.durationMs / 1000)} 秒 · {meta.output.width}×{meta.output.height}
              </span>
            </div>
            <video
              src={videoUrl}
              controls
              className="aspect-video w-full rounded-md bg-black shadow-md"
            />
          </div>
        </div>
        <aside className="w-[360px] flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-primary p-6">
          <h2 className="mb-4 text-[14px] font-semibold text-text-primary">下载</h2>
          <button
            type="button"
            id="p1-download-mp4"
            // Wired in Task 12
            className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md"
            style={{ background: 'var(--primary-600)' }}
            disabled
          >
            <I.Download size={16} /> 下载 MP4（占位 · Task 12 接入）
          </button>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

Expected: clean typecheck and build.

- [ ] **Step 10.3: Smoke test**

```bash
npm run dev
```

Repeat the recording flow from Task 9 step 9.6. After stop, the page should land on `/process/<id>` with the recorded webm playing inline. The Download button is greyed out (intentional — Task 12 hooks it up).

- [ ] **Step 10.4: Commit**

```bash
git add 'src/app/[locale]/process/[id]/page.tsx'
git commit -m "feat(p1): process page with inline webm player (download stubbed)"
```

---

## Task 11: screenWatermarkFilter utility

**Files:**
- Create: `src/utils/screenWatermarkFilter.ts`

ffmpeg `-filter_complex` builder for the frosted-glass `excalicast.cc` watermark. P1 uses a **simpler** variant than the existing canvas-based `frostedWatermark` — no real backdrop blur (would require multiple passes); instead a semi-transparent dark pill + soft white text. Refining to true backdrop-blur is a P2/P3 polish.

- [ ] **Step 11.1: Create the file**

```typescript
/**
 * Build the ffmpeg -filter_complex argument that overlays an `excalicast.cc`
 * watermark in the bottom-right corner (or bottom-left when camera is present).
 *
 * Assumes a font file is already inside ffmpeg's virtual FS at `watermark-latin.ttf`.
 *
 * Returned filter graph input label is `[0:v]` (the source video) and the final
 * label is `[wm]`. The caller maps `[wm]` to the output.
 */
export function buildScreenWatermarkFilter(opts: {
  hasCamera: boolean;
  videoH: number;
}): string {
  const corner = opts.hasCamera ? 'bl' : 'br';
  const fontSize = Math.max(14, Math.round(opts.videoH * 0.022));

  // Box geometry: roughly text-width-aware, but ffmpeg drawtext doesn't expose tw before drawing.
  // We use drawbox at a known size that fits "excalicast.cc" at the chosen fontSize.
  const boxW = Math.round(fontSize * 10);     // ~10 chars including padding
  const boxH = Math.round(fontSize * 1.8);
  const marginX = Math.round(opts.videoH * 0.025);
  const marginY = Math.round(opts.videoH * 0.04);

  // X / Y of the watermark box, expressed as ffmpeg expressions
  const xExpr = corner === 'br' ? `W-w-${marginX}` : `${marginX}`;
  const yExpr = `H-h-${marginY}`;

  // drawbox creates a semi-transparent dark pill; drawtext writes the URL inside.
  // x_drawtext / y_drawtext are absolute inside the frame.
  const textXExpr = corner === 'br'
    ? `W-${boxW + marginX} + (${boxW}-tw)/2`
    : `${marginX} + (${boxW}-tw)/2`;
  const textYExpr = `H-${boxH + marginY} + (${boxH}-th)/2`;

  return [
    `[0:v]drawbox=x=${xExpr}:y=${yExpr}:w=${boxW}:h=${boxH}:[email protected]:t=fill[bg]`,
    `[bg]drawtext=fontfile=watermark-latin.ttf:text='excalicast.cc'` +
      `:fontcolor=white@0.95:fontsize=${fontSize}` +
      `:x=${textXExpr}:y=${textYExpr}` +
      `:shadowcolor=black@0.4:shadowx=1:shadowy=1[wm]`,
  ].join(';');
}
```

- [ ] **Step 11.2: Verify typecheck**

```bash
npx --no-install tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11.3: Commit**

```bash
git add src/utils/screenWatermarkFilter.ts
git commit -m "feat(p1): ffmpeg filter builder for screen-record watermark"
```

---

## Task 12: screenExport service (webm → MP4 + watermark)

**Files:**
- Create: `src/services/screenExport.ts`

- [ ] **Step 12.1: Create the file**

```typescript
'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { loadScreenRecordingWebm, getScreenRecording } from '@/lib/db-client';
import { buildScreenWatermarkFilter } from '@/utils/screenWatermarkFilter';

let _ffmpeg: FFmpeg | null = null;
async function getFfmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
  await ffmpeg.load();
  _ffmpeg = ffmpeg;
  return ffmpeg;
}

export interface ScreenExportOptions {
  recordingId: string;
  withWatermark: boolean;          // false ONLY when current user is Pro at download-time
  onProgress?: (ratio: number) => void;
  onPhase?: (phase: 'loading' | 'transcoding' | 'done') => void;
  onLog?: (message: string) => void;
}

export async function exportScreenRecording(opts: ScreenExportOptions): Promise<Blob> {
  opts.onPhase?.('loading');
  opts.onProgress?.(0.02);

  const meta = await getScreenRecording(opts.recordingId);
  if (!meta) throw new Error(`recording_not_found: ${opts.recordingId}`);

  const webm = await loadScreenRecordingWebm(opts.recordingId);
  const ffmpeg = await getFfmpeg(opts.onLog);
  opts.onProgress?.(0.1);

  await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));

  if (opts.withWatermark) {
    const ttf = await fetchFile('/fonts/watermark-latin.ttf');
    await ffmpeg.writeFile('watermark-latin.ttf', ttf);
  }

  opts.onPhase?.('transcoding');
  opts.onProgress?.(0.15);

  ffmpeg.on('progress', ({ progress }) => {
    opts.onProgress?.(0.15 + Math.min(1, Math.max(0, progress)) * 0.83);
  });

  const args = ['-i', 'input.webm'];
  if (opts.withWatermark) {
    const filter = buildScreenWatermarkFilter({
      hasCamera: meta.hasCamera,
      videoH: meta.output.height,
    });
    args.push('-filter_complex', filter, '-map', '[wm]', '-map', '0:a?');
  } else {
    args.push('-map', '0:v', '-map', '0:a?');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    'output.mp4',
  );

  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile('output.mp4');
  const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

  // Cleanup
  try { await ffmpeg.deleteFile('input.webm'); } catch { /* */ }
  try { await ffmpeg.deleteFile('output.mp4'); } catch { /* */ }
  if (opts.withWatermark) {
    try { await ffmpeg.deleteFile('watermark-latin.ttf'); } catch { /* */ }
  }

  opts.onProgress?.(1);
  opts.onPhase?.('done');

  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return new Blob([buf], { type: 'video/mp4' });
}

export function downloadMp4Blob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 12.2: Wire the Download button on the process page**

Open `src/app/[locale]/process/[id]/page.tsx`. Replace the disabled placeholder button with the wired version. Add a new import at the top:

```typescript
import { useSubscription } from '@/hooks/useSubscription';
import { downloadMp4Blob, exportScreenRecording } from '@/services/screenExport';
```

Add state inside the component:

```typescript
const subscription = useSubscription();
const proUnlocked = subscription.permissions.exportWithoutWatermark;
const [busy, setBusy] = useState(false);
const [progress, setProgress] = useState<{ phase: string; ratio: number } | null>(null);

const handleDownload = async () => {
  setBusy(true);
  setProgress({ phase: 'loading', ratio: 0 });
  try {
    const blob = await exportScreenRecording({
      recordingId: id,
      withWatermark: !proUnlocked,
      onPhase: (p) => setProgress((s) => ({ phase: p, ratio: s?.ratio ?? 0 })),
      onProgress: (r) => setProgress((s) => ({ phase: s?.phase ?? 'transcoding', ratio: r })),
    });
    const tag = proUnlocked ? 'clean' : 'wm';
    downloadMp4Blob(blob, `excalicast_${id.slice(0, 8)}_${tag}.mp4`);
  } catch (err) {
    alert(`下载失败：${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    setBusy(false);
    setProgress(null);
  }
};
```

Replace the aside section with:

```tsx
<aside className="w-[360px] flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-primary p-6">
  <h2 className="mb-4 text-[14px] font-semibold text-text-primary">下载</h2>
  <button
    type="button"
    onClick={handleDownload}
    disabled={busy}
    className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-[13px] font-semibold text-white shadow-md disabled:opacity-50"
    style={{ background: 'var(--primary-600)' }}
  >
    <I.Download size={16} />
    {proUnlocked ? '下载 MP4（无水印）' : '下载 MP4（含水印）'}
  </button>
  {progress && (
    <div className="mt-3 rounded-md border border-border-default bg-bg-secondary p-3 text-[12px]">
      <div className="text-text-primary">
        {progress.phase === 'loading' && '加载中…'}
        {progress.phase === 'transcoding' && `转码中 ${Math.round(progress.ratio * 100)}%`}
        {progress.phase === 'done' && '已完成'}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-bg-tertiary">
        <div
          className="h-full bg-primary-600 transition-all"
          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>
    </div>
  )}
  <p className="mt-3 text-[11px] text-text-tertiary">
    {proUnlocked
      ? '✓ 已订阅 Pro · 无水印下载'
      : '升级 Pro 可去除水印，已录的视频也能重下 clean 版'}
  </p>
</aside>
```

- [ ] **Step 12.3: Verify typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

Expected: clean.

- [ ] **Step 12.4: Smoke test the full flow**

```bash
npm run dev
```

1. Go to `/zh/app`, click 开始录制 → select source → pause → resume → stop
2. On the process page, the video plays inline
3. Click "下载 MP4（含水印）"
4. Watch the progress bar climb from 0 → ~100%
5. Browser auto-downloads `excalicast_<id>_wm.mp4`
6. Open the MP4 in QuickTime / VLC: video + audio (if mic was on) play; bottom-right shows the `excalicast.cc` pill (or bottom-left when camera was enabled)
7. (Optional, if you can simulate Pro: set `proUnlocked = true` temporarily in the page or use the existing `/api/dev/grant-pro` route to flip the flag, then re-download — file should be `excalicast_<id>_clean.mp4` with no watermark)

- [ ] **Step 12.5: Commit**

```bash
git add src/services/screenExport.ts 'src/app/[locale]/process/[id]/page.tsx'
git commit -m "feat(p1): screenExport service + wire download button (Free=wm / Pro=clean)"
```

---

## Task 13: RecordingsList — union of old + new

**Files:**
- Modify: `src/components/RecordingsList.tsx`

Today the library shows scene-replay recordings. We need to include screen-capture recordings too, sorted together by `startedAt`. Clicking an old one goes to `/play/[id]`; a new one goes to `/process/[id]`.

- [ ] **Step 13.1: Read the existing file**

```bash
wc -l src/components/RecordingsList.tsx
head -60 src/components/RecordingsList.tsx
```

The file currently loads only old recordings via `listRecordings()`. We're adding a parallel load for screen-capture recordings.

- [ ] **Step 13.2: Add import**

In `src/components/RecordingsList.tsx`, add:

```typescript
import { listScreenRecordings, deleteScreenRecording } from '@/lib/db-client';
import type { ScreenRecordingMetadata } from '@/types/recording';
```

- [ ] **Step 13.3: Change the MergedItem type**

The current `MergedItem` is `{ id, local: RecordingMetadata | null, cloud: ... }`. Restructure it to:

```typescript
interface MergedItem {
  id: string;
  kind: 'scene_replay' | 'screen_capture';
  startedAt: number;
  durationMs: number;
  title?: string;
  hasAudio: boolean;
  hasCamera: boolean;
  thumbnail?: string | null;
  status: 'recording' | 'done' | 'error';
}

function fromSceneReplay(m: RecordingMetadata): MergedItem {
  return {
    id: m.id,
    kind: 'scene_replay',
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    title: m.title,
    hasAudio: m.hasAudio,
    hasCamera: m.hasCamera,
    thumbnail: m.lastFrameThumbnail,
    status: m.status,
  };
}

function fromScreenCapture(m: ScreenRecordingMetadata): MergedItem {
  return {
    id: m.id,
    kind: 'screen_capture',
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    title: m.title,
    hasAudio: m.hasMic || m.hasSystemAudio,
    hasCamera: m.hasCamera,
    thumbnail: m.thumbnail ?? null,
    status: m.status,
  };
}
```

- [ ] **Step 13.4: Update the `refresh` function**

```typescript
const refresh = useCallback(async () => {
  const [localOld, localNew] = await Promise.all([
    listRecordings(),
    listScreenRecordings(),
  ]);
  const items: MergedItem[] = [
    ...localOld.map(fromSceneReplay),
    ...localNew.map(fromScreenCapture),
  ].sort((a, b) => b.startedAt - a.startedAt);
  setItems(items);
  setLoaded(true);
}, []);
```

- [ ] **Step 13.5: Update card click + delete to route by kind**

In the JSX where the card's Link is rendered, change the `href` to:

```tsx
<Link href={`/${item.kind === 'screen_capture' ? 'process' : 'play'}/${item.id}` as never}>
```

And in the delete handler:

```typescript
const handleDelete = useCallback(async (it: MergedItem) => {
  if (!confirm(t('deleteConfirm'))) return;
  if (it.kind === 'screen_capture') await deleteScreenRecording(it.id);
  else await deleteRecording(it.id);
  await refresh();
}, [refresh, t]);
```

Also rip out the existing cloud-sync buttons (saveToCloud / removeFromCloud / etc.) — they reference deleted `cloudSync.ts` which will fail to import in Task 14. Strip those UI elements **before running typecheck**.

- [ ] **Step 13.6: Verify typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

If there are errors about missing `cloudSync` imports, finish stripping those. Build must pass.

- [ ] **Step 13.7: Commit**

```bash
git add src/components/RecordingsList.tsx
git commit -m "feat(p1): library shows both scene-replay and screen-capture recordings"
```

---

## Task 14: Cleanup — delete dead cloud-sync code

**Files:**
- Delete: `src/services/cloudSync.ts`
- Delete: `src/services/workspaceShellCapture.ts`
- Delete: `src/components/WorkspaceShellToggle.tsx`
- Delete: `src/app/api/recordings/register/route.ts`
- Delete: `src/app/api/recordings/list/route.ts`
- Delete: `src/app/api/recordings/[id]/route.ts`
- Modify: `src/lib/db.ts` (remove `listCloudRecordings`, `getCloudRecording`, `upsertCloudRecording`, `updateCloudRecordingTitle`, `deleteCloudRecording`, `removeCloudRecordingObjects` and the `RecordingCloudRow` interface)

- [ ] **Step 14.1: Delete files**

```bash
rm src/services/cloudSync.ts
rm src/services/workspaceShellCapture.ts
rm src/components/WorkspaceShellToggle.tsx
rm -r src/app/api/recordings
```

- [ ] **Step 14.2: Strip recordings_cloud helpers from `src/lib/db.ts`**

Open `src/lib/db.ts`. Locate the section starting with the comment `// recordings_cloud (Supabase only ...)` (or similar). Delete:
- The `RecordingCloudRow` interface and any `Supabase*Row` interface tied to it
- The `rowToRecordingCloud` helper
- The `requireSupabase` helper (only if it's not used by anything else — grep first to confirm)
- All exported functions: `listCloudRecordings`, `getCloudRecording`, `upsertCloudRecording`, `updateCloudRecordingTitle`, `deleteCloudRecording`, `removeCloudRecordingObjects`

```bash
grep -n "RecordingCloudRow\|listCloudRecordings\|getCloudRecording\|upsertCloudRecording\|updateCloudRecordingTitle\|deleteCloudRecording\|removeCloudRecordingObjects\|requireSupabase" src/lib/db.ts
```

Use the line numbers reported to identify the section, then remove it.

- [ ] **Step 14.3: Find + fix any leftover imports**

```bash
grep -rln "cloudSync\|recordings_cloud\|WorkspaceShellToggle\|workspaceShellCapture" src/ --include='*.ts' --include='*.tsx'
```

Each match must be fixed (remove the import, remove dead usage). Likely candidates: `RecordingsList.tsx` (handled in Task 13), `RecordSetupModal`/`ExportPanel` may still reference WorkspaceShellToggle — strip.

- [ ] **Step 14.4: Verify typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

Both must pass with no `Cannot find module` errors.

- [ ] **Step 14.5: Commit**

```bash
git add -A src/ docs/
git commit -m "chore(p1): remove cloud-sync code + workspace-shell capture (no longer needed)"
```

---

## Task 15: SQL migration to drop recordings_cloud

**Files:**
- Create: `supabase/migrations/20260520_drop_recordings_cloud.sql`

- [ ] **Step 15.1: Create the migration**

```sql
-- 2026-05-20: Drop cloud-backup schema.
--
-- Screen-record refactor (commit 887cde6 spec) removes cloud sync entirely.
-- Per spec: video / audio / subtitles / outline are all local-only from now on.
--
-- This migration:
--   1. Drops storage.objects policies bound to the `recordings` bucket
--   2. Removes the bucket itself (any uploaded objects are deleted)
--   3. Drops the `public.recordings_cloud` table and its trigger

DROP POLICY IF EXISTS "recordings_self_select" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_insert" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_update" ON storage.objects;
DROP POLICY IF EXISTS "recordings_self_delete" ON storage.objects;

-- Note: deleting from storage.buckets cascades into storage.objects for that bucket.
DELETE FROM storage.objects WHERE bucket_id = 'recordings';
DELETE FROM storage.buckets WHERE id = 'recordings';

DROP TRIGGER IF EXISTS recordings_cloud_touch ON public.recordings_cloud;
DROP TABLE IF EXISTS public.recordings_cloud;
```

- [ ] **Step 15.2: Commit**

```bash
git add supabase/migrations/20260520_drop_recordings_cloud.sql
git commit -m "chore(p1): SQL migration to drop recordings_cloud bucket + table"
```

This migration is **NOT** applied automatically — you (the operator) need to apply it via `npx supabase db push` or the Supabase dashboard when ready to roll out P1. The git commit is the artifact; the actual DB change is operational.

---

## Task 16: Update CLAUDE.md (reverse getDisplayMedia ban)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 16.1: Update the "禁止事项" section**

In `CLAUDE.md`, find the line:

```
- ❌ **绝对不用 `getDisplayMedia()`** 采集画板内容——录屏幕像素，遮挡/最小化时内容错误
```

Replace it with:

```
- ❌ ~~不用 `getDisplayMedia()`~~ **反转（2026-05-20）**：screen-record 重构后 getDisplayMedia 成为新录制路径的核心 API。旧 scene-replay 录制（保留 read-only）仍以 onChange 事件流为采集源
- ❌ **水印永远在下载阶段合成**，绝不在录制阶段烧入 webm。理由：Pro 升级后可对历史录制重下 clean MP4
- ❌ **不上传任何视频 / 音频到服务器**（DashScope 字幕识别例外，仍仅是临时上传）
- ❌ 不再引入云端备份 / 跨浏览器同步（云端 storage bucket 已删除）
```

- [ ] **Step 16.2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(p1): reverse getDisplayMedia ban + add download-time watermark constraint"
```

---

## Task 17: Final smoke + push

- [ ] **Step 17.1: Full typecheck + build**

```bash
npx --no-install tsc --noEmit && npx --no-install next build
```

Both must pass clean.

- [ ] **Step 17.2: End-to-end manual smoke**

```bash
npm run dev
```

Walk through, with notes for each step's expected state:

1. Visit `/zh/app`
   - Workspace renders normally; "开始录制" button is visible
2. Click 开始录制
   - Modal opens; mic toggle on by default
3. Enable camera toggle, click 选择录制源
   - Chrome shows system picker
4. Pick "Chrome 标签页" → pick this tab → 共享
   - Returns to the page; floating bar appears at the bottom
   - The camera bubble overlay is visible (because we enabled camera)
5. Draw something on Excalidraw / switch to another tab momentarily
   - Recording continues (track stays live)
6. Click stop on the floating bar
   - Page navigates to `/process/<id>`
   - Video plays inline with the recorded content
7. Click 下载 MP4（含水印）
   - Progress bar climbs 0 → 100%
   - Browser downloads `excalicast_<id>_wm.mp4`
8. Open the MP4 in QuickTime
   - Plays correctly, watermark visible in bottom-{right|left} depending on camera
9. Navigate to `/zh/library`
   - The new recording shows next to any old scene-replay recordings, sorted by date
   - Click the new one → lands on `/process/<id>` ✓
   - Click an old one (if any exist) → lands on `/play/<id>` ✓

If any step fails, fix the underlying bug and re-run from step 17.1.

- [ ] **Step 17.3: Push to origin**

```bash
git push -u origin feature/screen-record
```

Expected: GitHub accepts the push and reports the branch.

---

## Self-Review (after writing, before handoff)

This section is for the planner (Claude) to double-check the plan against the spec.

**Spec coverage** for P1's scope:
- ✅ getDisplayMedia source picker (Tasks 4, 9)
- ✅ Mic + system audio (Tasks 4, 5, 7)
- ✅ Camera bubble live-composited (Task 5)
- ✅ MediaRecorder → IndexedDB chunks (Tasks 3, 6)
- ✅ Process page with inline player + Download MP4 (Tasks 10, 12)
- ✅ webm → MP4 transcode (Task 12)
- ✅ Watermark at download time, Free vs Pro distinction (Tasks 11, 12)
- ✅ Pro upgrade retroactively works (verified by reading `proUnlocked` at download time)
- ✅ Old scene-replay coexistence (Task 13)
- ✅ Cloud sync teardown (Tasks 14, 15)
- ✅ CLAUDE.md updated (Task 16)
- ⛔ Aspect ratio picker (deferred to P2 — intentional)
- ⛔ Crop region selector (deferred to P2 — intentional)
- ⛔ Teleprompter + PiP (deferred to P3 — intentional)
- ⛔ Real-time subtitle (deferred to P4 — intentional)
- ⛔ AI outline / 讲义 (deferred to P4 — intentional)

**Placeholder scan:** no "TBD" / "TODO" / "fill in later" — all steps contain concrete code or commands.

**Type consistency check:**
- `ScreenRecordingMetadata` / `ScreenRecordingChunk` defined Task 2, used Tasks 3, 6, 10, 12, 13 — consistent
- `RecordingKind` type used in 13's MergedItem — consistent
- `RecordSetupValues` defined Task 7, used Task 9 — consistent
- `ScreenRecordingHandle` defined Task 6, used Task 9 — consistent
- `screenSessionRef`, `screenState` introduced in Task 9 — used only in Task 9
- Helper function names: `appendScreenChunk` / `getScreenRecording` / `putScreenRecording` / `updateScreenRecording` / `loadScreenRecordingWebm` / `listScreenRecordings` / `deleteScreenRecording` all defined Task 3, used consistently in Tasks 6, 10, 12, 13.
