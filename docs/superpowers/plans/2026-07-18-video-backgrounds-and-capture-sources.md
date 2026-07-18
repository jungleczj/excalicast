# Video Backgrounds and Capture Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add video background selection to new recordings and exports, then add more recording source options: whiteboard, current tab, window, entire desktop, and selected area.

**Architecture:** Extend the existing `RecordingSetupConfig → RecordingMetadata.setup → ExportConfig → renderPreviewFrame/exportRecording` flow. Video backgrounds are stored as optional setup/export config and painted as the first layer in preview/export. Capture sources are introduced as a separate recording source layer so existing whiteboard recording remains stable while display capture modes can be added behind a clear interface.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Dexie IndexedDB, MediaRecorder, `navigator.mediaDevices.getDisplayMedia`, Excalidraw `exportToCanvas`, WebCodecs/FFmpeg export pipeline, existing Playwright e2e tests.

## Global Constraints

- Do not modify API routes, Supabase migrations, subscription/payment rules, or server-side billing logic.
- Do not change existing route paths.
- Preserve current whiteboard recording behavior as the default.
- Preserve current `RecordingSetupConfig` and `ExportConfig` compatibility for old recordings; all new fields must be optional.
- Browser limitation: web apps cannot force users into a specific OS window/desktop choice. `getDisplayMedia` can provide hints such as `displaySurface`, but the browser picker remains user-controlled.
- Selected-area recording must be implemented as an app-level crop/composition step after browser permission. The stored recording chunks must contain only the selected area, not the full granted display stream.
- Visual implementation must follow the existing Craft direction: paper surface, low-contrast borders, rounded cards, restrained color, compact labels, no hard sketch shadows in new controls.

---

## Current Code Map

### Existing flow to preserve

- `src/components/RecordingSetup.tsx`
  - Owns the pre-recording setup modal.
  - Currently controls aspect/framing, workspace shell, camera, mic.
- `src/app/[locale]/app/page.tsx`
  - Opens setup modal.
  - Applies setup into framing mode.
  - Starts countdown and calls `startRecording`.
  - Persists final `cropWindow` into `metadata.setup` before navigating to export.
- `src/types/recording.ts`
  - Defines `RecordingMetadata`, `RecordingSetupConfig`, `ExportConfig`, aspect/crop/resolution types.
- `src/services/recordingSession.ts`
  - Creates local recording metadata.
  - Stores Excalidraw snapshots, audio chunks, camera chunks, camera positions, laser events, workspace shell snapshots.
- `src/lib/db-client.ts`
  - Dexie local DB.
  - `recordings` stores the metadata object and can store new optional fields without indexing them.
- `src/app/[locale]/export/[id]/page.tsx`
  - Converts `metadata.setup` into default `ExportConfig`.
  - Sends `config` into preview, panels, export.
- `src/components/ExportPreview.tsx`
  - Calls `renderPreviewFrame`.
  - Shows camera overlay live.
- `src/services/exportPipeline.ts`
  - Core render/export path.
  - Builds output canvas, draws white background, shell, Excalidraw scene, laser, watermark, subtitles, and camera.

### Existing limitations relevant to this plan

- There is no concept of video background; preview/export starts with a hard white fill.
- There is no screen/display source recording table.
- Current recording source is implicitly “Excalidraw whiteboard snapshots plus optional shell”.
- Current setup modal is already long; background/source additions must avoid turning it into a control wall.

---

## Design System / Craft Style Rules

Use these rules before touching components:

- Background cards:
  - `#FCF9F7` / `#FFFDF8` paper base.
  - Border: `rgba(31,34,37,.10)` to `rgba(31,34,37,.16)`, never heavy black for new controls.
  - Shadow: soft ambient shadow only, no hard offset black shadows in new sections.
  - Radius: 20–32px for major surfaces; 999px for pills; 14–18px for option chips.
- Typography:
  - Section title: Geist/serif only where editorial emphasis is needed.
  - Setup controls: Geist, 13–15px body, 11–12px muted labels.
  - Avoid monospaced uppercase except very small technical metadata.
- Interaction:
  - Selection state is black pill/card or pale blue fill with subtle ring.
  - Hover: `translateY(-1px)` and background shift only.
  - Reduced motion: no transform animations.
- Visual density:
  - One concept per row/section.
  - For background selection, show swatches first, advanced controls collapsed.
  - For capture source selection, show five large options with short labels and one-line descriptions.

---

## Task 1: Add Background Types and Defaults

**Files:**
- Modify: `src/types/recording.ts`
- Create: `src/config/videoBackgrounds.ts`

**Interfaces:**
- Produces:
  - `VideoBackgroundConfig`
  - `VideoBackgroundPreset`
  - `VIDEO_BACKGROUND_PRESETS`
  - `DEFAULT_VIDEO_BACKGROUND`
- Consumed by:
  - Recording setup UI.
  - Export defaults mapper.
  - Preview/export render utilities.

- [ ] **Step 1: Extend recording types with optional video background fields**

Add these types near the recording setup section in `src/types/recording.ts`:

```ts
export type VideoBackgroundKind = 'none' | 'preset';

export type VideoBackgroundTone =
  | 'all'
  | 'fresh'
  | 'soft'
  | 'dark'
  | 'natural';

export interface VideoBackgroundConfig {
  kind: VideoBackgroundKind;
  presetId?: string;
  tone?: VideoBackgroundTone;
  /** Background blur in pixels, applied only to visual preset layers that support it. */
  blurPx?: number;
  /** 0..1 overlay strength for softening high-chroma presets. */
  dim?: number;
}
```

Extend `RecordingSetupConfig`:

```ts
export interface RecordingSetupConfig {
  framing: AspectRatio | 'default' | 'custom';
  croppingMode: CroppingMode;
  includeWorkspaceShell: boolean;
  cropWindow?: CropWindow;
  customOutput?: { width: number; height: number };
  camera: CameraSetupConfig;
  videoBackground?: VideoBackgroundConfig;
}
```

Extend `ExportConfig`:

```ts
export interface ExportConfig {
  aspectRatio: AspectRatio;
  croppingMode: CroppingMode;
  fps: number;
  withWatermark: boolean;
  exportRatios?: AspectRatio[];
  resolution?: ExportResolution;
  format?: ExportFormat;
  quality?: ExportQuality;
  burnSubtitles?: boolean;
  includeWorkspaceShell?: boolean;
  cropWindow?: CropWindow;
  customOutput?: { width: number; height: number };
  segments?: TimeSegment[];
  videoBackground?: VideoBackgroundConfig;
}
```

- [ ] **Step 2: Create background preset config**

Create `src/config/videoBackgrounds.ts`:

```ts
import type { VideoBackgroundConfig, VideoBackgroundTone } from '@/types/recording';

export interface VideoBackgroundPreset {
  id: string;
  tone: Exclude<VideoBackgroundTone, 'all'>;
  labelZh: string;
  labelEn: string;
  asset: string;
  preview: string;
}

export const DEFAULT_VIDEO_BACKGROUND: VideoBackgroundConfig = {
  kind: 'none',
};

export const VIDEO_BACKGROUND_PRESETS: VideoBackgroundPreset[] = [
  {
    id: 'paper-sky',
    tone: 'fresh',
    labelZh: '纸感蓝',
    labelEn: 'Paper sky',
    asset: '/video-backgrounds/paper-sky.svg',
    preview: '/video-backgrounds/paper-sky.svg',
  },
  {
    id: 'soft-mint',
    tone: 'soft',
    labelZh: '柔和绿',
    labelEn: 'Soft mint',
    asset: '/video-backgrounds/soft-mint.svg',
    preview: '/video-backgrounds/soft-mint.svg',
  },
  {
    id: 'warm-yellow',
    tone: 'natural',
    labelZh: '暖黄纸',
    labelEn: 'Warm paper',
    asset: '/video-backgrounds/warm-yellow.svg',
    preview: '/video-backgrounds/warm-yellow.svg',
  },
  {
    id: 'lavender-note',
    tone: 'soft',
    labelZh: '淡紫便笺',
    labelEn: 'Lavender note',
    asset: '/video-backgrounds/lavender-note.svg',
    preview: '/video-backgrounds/lavender-note.svg',
  },
  {
    id: 'charcoal-paper',
    tone: 'dark',
    labelZh: '深色纸面',
    labelEn: 'Charcoal paper',
    asset: '/video-backgrounds/charcoal-paper.svg',
    preview: '/video-backgrounds/charcoal-paper.svg',
  },
];

export function resolveVideoBackground(
  config?: VideoBackgroundConfig,
): VideoBackgroundConfig {
  if (!config || config.kind === 'none') return DEFAULT_VIDEO_BACKGROUND;
  if (!config.presetId) return DEFAULT_VIDEO_BACKGROUND;
  return config;
}
```

- [ ] **Step 3: Verify type compatibility**

Run:

```bash
npm run typecheck
```

Expected:

```text
exit 0
```

- [ ] **Step 4: Commit**

```bash
git add src/types/recording.ts src/config/videoBackgrounds.ts
git commit -m "feat: add video background config types"
```

---

## Task 2: Generate Craft-Style SVG Background Assets

**Files:**
- Create: `public/video-backgrounds/paper-sky.svg`
- Create: `public/video-backgrounds/soft-mint.svg`
- Create: `public/video-backgrounds/warm-yellow.svg`
- Create: `public/video-backgrounds/lavender-note.svg`
- Create: `public/video-backgrounds/charcoal-paper.svg`

**Interfaces:**
- Consumes: `VIDEO_BACKGROUND_PRESETS[].asset`
- Produces: 1920×1080 SVG background assets.

- [ ] **Step 1: Create five 16:9 vector backgrounds**

Each SVG must:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" fill="none">
```

Shared visual rules:

- Use paper grain patterns.
- Use 2–4 large irregular paper blocks.
- No raster images.
- No people/pet assets.
- No text embedded in the backgrounds.
- Colors should be derived from existing homepage persona tones:
  - `#EAF3FF`
  - `#FFF0D7`
  - `#EAF7EC`
  - `#F2EDFF`
  - `#FFECEC`
  - `#EEF2F6`

- [ ] **Step 2: Add static asset checks**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const files = [
  'public/video-backgrounds/paper-sky.svg',
  'public/video-backgrounds/soft-mint.svg',
  'public/video-backgrounds/warm-yellow.svg',
  'public/video-backgrounds/lavender-note.svg',
  'public/video-backgrounds/charcoal-paper.svg',
];
for (const file of files) {
  const svg = fs.readFileSync(file, 'utf8');
  if (!svg.includes('viewBox="0 0 1920 1080"')) throw new Error(`${file}: wrong viewBox`);
  if (/<image\b/i.test(svg)) throw new Error(`${file}: raster image reference found`);
  if (/>[^<]*(Excalicast|Craft|Recording|录制)[^<]*</i.test(svg)) throw new Error(`${file}: text content found`);
}
console.log('video background assets ok');
NODE
```

Expected:

```text
video background assets ok
```

- [ ] **Step 3: Commit**

```bash
git add public/video-backgrounds
git commit -m "feat: add craft style video backgrounds"
```

---

## Task 3: Add Background Picker to New Recording Setup

**Files:**
- Modify: `src/components/RecordingSetup.tsx`
- Modify: `src/messages/zh.json`
- Modify: `src/messages/en.json`

**Interfaces:**
- Consumes:
  - `VIDEO_BACKGROUND_PRESETS`
  - `VideoBackgroundConfig`
- Produces:
  - `RecordingSetupConfig.videoBackground`

- [ ] **Step 1: Add local setup state**

In `RecordingSetup.tsx`, initialize:

```ts
const [videoBackground, setVideoBackground] = useState<VideoBackgroundConfig>(
  initial.videoBackground ?? DEFAULT_VIDEO_BACKGROUND,
);
const [backgroundTone, setBackgroundTone] = useState<VideoBackgroundTone>('all');
```

Import:

```ts
import { DEFAULT_VIDEO_BACKGROUND, VIDEO_BACKGROUND_PRESETS } from '@/config/videoBackgrounds';
import type { VideoBackgroundConfig, VideoBackgroundTone } from '@/types/recording';
```

- [ ] **Step 2: Include background in `handleStart`**

```ts
const config: RecordingSetupConfig = {
  framing,
  croppingMode: framing === 'default' ? 'fit_all_content' : 'follow_viewport',
  includeWorkspaceShell: includeShell,
  camera: { enabled: camEnabled, sizePx: size, shape, position: pos, backgroundRemoval: bgRemove },
  videoBackground,
};
```

- [ ] **Step 3: Add a Craft-style background section**

Place it after aspect ratio and before camera.

UI structure:

```tsx
<SetupSection title={t('background.title')} subtitle={t('background.subtitle')}>
  <BackgroundTonePills value={backgroundTone} onChange={setBackgroundTone} />
  <BackgroundSwatchGrid
    value={videoBackground}
    tone={backgroundTone}
    onChange={setVideoBackground}
  />
</SetupSection>
```

Design details:

- Include a “None / No background” swatch first.
- Swatches are 120×76 desktop and 96×60 mobile.
- Selected swatch: black 2px ring plus small check pill.
- No hard offset shadow.
- Filter pills: All / Fresh / Soft / Dark / Natural.
- Keep advanced controls out of first implementation except `none` and preset choice.

- [ ] **Step 4: Add translations**

Add under `recordingSetup`:

```json
{
  "background": {
    "title": "背景",
    "subtitle": "为录制和后续导出选择统一的视频底色。",
    "none": "无背景",
    "all": "全部",
    "fresh": "鲜艳",
    "soft": "柔和",
    "dark": "深色",
    "natural": "自然"
  }
}
```

English:

```json
{
  "background": {
    "title": "Background",
    "subtitle": "Choose one video backdrop for recording and later exports.",
    "none": "None",
    "all": "All",
    "fresh": "Fresh",
    "soft": "Soft",
    "dark": "Dark",
    "natural": "Natural"
  }
}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run typecheck
```

Expected:

```text
exit 0
```

- [ ] **Step 6: Commit**

```bash
git add src/components/RecordingSetup.tsx src/messages/zh.json src/messages/en.json
git commit -m "feat: add recording background picker"
```

---

## Task 4: Persist Background Through Recording Metadata and Export Defaults

**Files:**
- Modify: `src/app/[locale]/app/page.tsx`
- Modify: `src/app/[locale]/export/[id]/page.tsx`

**Interfaces:**
- Consumes:
  - `RecordingSetupConfig.videoBackground`
- Produces:
  - `ExportConfig.videoBackground`

- [ ] **Step 1: Update `DEFAULT_SETUP`**

In `src/app/[locale]/app/page.tsx`:

```ts
const DEFAULT_SETUP: RecordingSetupConfig = {
  framing: '16:9',
  croppingMode: 'follow_viewport',
  includeWorkspaceShell: false,
  camera: { enabled: false, sizePx: 160, shape: 'circle', position: 'bottom-right', backgroundRemoval: false },
  videoBackground: { kind: 'none' },
};
```

- [ ] **Step 2: Persist final setup without losing background**

Current stop handler already spreads `setupConfig`. Keep that behavior and ensure no code overwrites `videoBackground`:

```ts
setup: {
  ...setupConfig,
  cropWindow: cw,
  ...(setupConfig.framing === 'custom' && customOutput ? { customOutput } : {}),
}
```

For `default` framing, add a metadata update so setup still persists later changes:

```ts
if (setupConfig.framing === 'default') {
  await getClientDb().recordings.update(meta.id, {
    setup: setupConfig,
  });
}
```

- [ ] **Step 3: Map setup into export defaults**

In `exportDefaultsFromSetup`, include:

```ts
const base: ExportConfig = {
  ...DEFAULT_CONFIG,
  includeWorkspaceShell: setup.includeWorkspaceShell,
  videoBackground: setup.videoBackground,
};
```

- [ ] **Step 4: Verify old recordings still load**

Manual check:

- Open an old recording with no `setup`.
- Export page must use `DEFAULT_CONFIG`.
- No crash when `videoBackground` is undefined.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/app/page.tsx' 'src/app/[locale]/export/[id]/page.tsx'
git commit -m "feat: persist recording video background"
```

---

## Task 5: Paint Background in Preview and Export

**Files:**
- Create: `src/services/videoBackgroundRenderer.ts`
- Modify: `src/services/exportPipeline.ts`
- Modify: `src/components/ExportPreview.tsx`

**Interfaces:**
- Consumes:
  - `ExportConfig.videoBackground`
  - `VideoBackgroundPreset.asset`
- Produces:
  - Background layer rendered before shell/scene/camera/subtitles/watermark.

- [ ] **Step 1: Create background renderer utility**

Create `src/services/videoBackgroundRenderer.ts`:

```ts
'use client';

import { VIDEO_BACKGROUND_PRESETS, resolveVideoBackground } from '@/config/videoBackgrounds';
import type { VideoBackgroundConfig } from '@/types/recording';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`background_load_failed:${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export async function paintVideoBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config?: VideoBackgroundConfig,
): Promise<void> {
  const bg = resolveVideoBackground(config);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (bg.kind === 'none' || !bg.presetId) {
    ctx.restore();
    return;
  }
  const preset = VIDEO_BACKGROUND_PRESETS.find((item) => item.id === bg.presetId);
  if (!preset) {
    ctx.restore();
    return;
  }
  const img = await loadImage(preset.asset);
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;
  if (bg.blurPx && bg.blurPx > 0) ctx.filter = `blur(${bg.blurPx}px)`;
  ctx.drawImage(img, x, y, drawW, drawH);
  if (bg.dim && bg.dim > 0) {
    ctx.filter = 'none';
    ctx.fillStyle = `rgba(255,253,248,${Math.min(0.6, Math.max(0, bg.dim))})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}
```

- [ ] **Step 2: Replace hard white fill in `exportRecording`**

In `composeFrame`, replace:

```ts
targetCtx.fillStyle = '#ffffff';
targetCtx.fillRect(0, 0, target.width, target.height);
```

with:

```ts
await paintVideoBackground(targetCtx, target.width, target.height, opts.videoBackground);
```

- [ ] **Step 3: Replace hard white fill in `renderPreviewFrame`**

Replace:

```ts
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, target.width, target.height);
```

with:

```ts
await paintVideoBackground(ctx, target.width, target.height, config.videoBackground);
```

- [ ] **Step 4: Keep Excalidraw scene background from hiding video background**

When calling `exportToCanvas`, keep the Excalidraw canvas itself white for current behavior inside the scene area. Do not change:

```ts
exportBackground: true,
viewBackgroundColor: '#ffffff',
```

Reason: the video background should fill output outside/behind the recorded content. Whiteboard content stays readable.

- [ ] **Step 5: Verify preview/export parity**

Manual checks:

- Select `paper-sky`.
- Record a 16:9 whiteboard.
- Open export page.
- Preview background matches setup.
- Export MP4 first frame matches preview background.
- Switch export ratio to 9:16; background cover-fills without stretching.

- [ ] **Step 6: Commit**

```bash
git add src/services/videoBackgroundRenderer.ts src/services/exportPipeline.ts src/components/ExportPreview.tsx
git commit -m "feat: render video backgrounds in preview and export"
```

---

## Task 6: Add Export-Side Background Adjustment

**Files:**
- Create: `src/components/VideoBackgroundPanel.tsx`
- Modify: `src/app/[locale]/export/[id]/page.tsx`
- Modify: `src/messages/zh.json`
- Modify: `src/messages/en.json`

**Interfaces:**
- Consumes:
  - `ExportConfig.videoBackground`
- Produces:
  - Updated `ExportConfig.videoBackground`

- [ ] **Step 1: Create `VideoBackgroundPanel`**

Component API:

```ts
interface Props {
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
  en: boolean;
}
```

Behavior:

- Shows current background.
- Allows `none` and preset selection.
- Optional advanced section:
  - Blur: 0 / 8 / 16.
  - Soft overlay: 0 / .18 / .32.
- This only changes export config first; do not persist globally in this task.

- [ ] **Step 2: Insert panel in export tab**

Order:

1. `WorkspaceShellToggle`
2. `ExportRatioPicker`
3. `VideoBackgroundPanel`
4. `ExportFormatPanel`
5. `ExportPanel`

- [ ] **Step 3: Add translations**

Add:

```json
{
  "videoBackground": {
    "title": "视频背景",
    "subtitle": "沿用录制设置，也可以为这次导出单独调整。",
    "none": "无背景",
    "blur": "模糊",
    "dim": "柔化"
  }
}
```

English:

```json
{
  "videoBackground": {
    "title": "Video background",
    "subtitle": "Use the recording default, or adjust this export.",
    "none": "None",
    "blur": "Blur",
    "dim": "Soften"
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck
npm run build
```

Expected:

```text
both commands exit 0
```

- [ ] **Step 5: Commit**

```bash
git add src/components/VideoBackgroundPanel.tsx 'src/app/[locale]/export/[id]/page.tsx' src/messages/zh.json src/messages/en.json
git commit -m "feat: adjust video backgrounds on export"
```

---

## Task 7: Add Capture Source Types and DB Storage

**Files:**
- Modify: `src/types/recording.ts`
- Modify: `src/lib/db-client.ts`

**Interfaces:**
- Produces:
  - Capture source types.
  - New `screenChunks` Dexie table.
  - `screenBlob` returned from `loadFullRecording`.

- [ ] **Step 1: Add source types**

In `src/types/recording.ts`:

```ts
export type RecordingSourceKind =
  | 'whiteboard'
  | 'current_tab'
  | 'window'
  | 'desktop'
  | 'selected_area';

export interface SourceCropWindow {
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

export interface RecordingSourceConfig {
  kind: RecordingSourceKind;
  /** Browser display surface hint; not a guarantee. */
  displaySurface?: 'browser' | 'window' | 'monitor';
  /** For selected_area: crop inside the granted display stream. */
  sourceCropWindow?: SourceCropWindow;
  /** Tab audio is only available when the browser grants it. */
  captureSystemAudio?: boolean;
}

export interface ScreenChunk {
  recordingId: string;
  index: number;
  blob: Blob;
}
```

Extend:

```ts
export interface RecordingMetadata {
  // existing fields...
  source?: RecordingSourceConfig;
}

export interface RecordingSetupConfig {
  // existing fields...
  source?: RecordingSourceConfig;
}
```

- [ ] **Step 2: Add Dexie table version**

In `src/lib/db-client.ts`:

```ts
interface ScreenChunkRow extends ScreenChunk {
  id?: number;
}

class ExcalicastDB extends Dexie {
  // existing tables...
  screenChunks!: Table<ScreenChunkRow, number>;
}
```

Add version 10:

```ts
this.version(10).stores({
  recordings: 'id, startedAt, status, ownerKey',
  snapshots: '++id, recordingId, timestamp',
  audioChunks: '++id, recordingId, index',
  cameraChunks: '++id, recordingId, index',
  screenChunks: '++id, recordingId, index',
  binaryFiles: '++id, recordingId, fileId',
  workspaceShells: '++id, recordingId, timestamp, hash, [recordingId+timestamp]',
  cameraPositions: '++id, recordingId, timestamp, [recordingId+timestamp]',
  libraryItems: 'id, status, created',
  laserEvents: '++id, recordingId, timestamp, [recordingId+timestamp]',
});
```

- [ ] **Step 3: Include `screenChunks` in delete transaction**

Add `db.screenChunks` to the table list and delete:

```ts
await db.screenChunks.where('recordingId').equals(recordingId).delete();
```

- [ ] **Step 4: Extend `loadFullRecording`**

Return:

```ts
screenBlob: Blob | null;
```

Implementation:

```ts
const screenRows = await db.screenChunks
  .where('recordingId').equals(recordingId)
  .sortBy('index');
const screenBlob = screenRows.length > 0
  ? new Blob(screenRows.map((c) => c.blob), { type: screenRows[0].blob.type || 'video/webm' })
  : null;
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run typecheck
```

Expected:

```text
exit 0
```

- [ ] **Step 6: Commit**

```bash
git add src/types/recording.ts src/lib/db-client.ts
git commit -m "feat: add display capture storage"
```

---

## Task 8: Add Display Capture Recorder and Composition Service

**Files:**
- Create: `src/services/displayCaptureRecorder.ts`

**Interfaces:**
- Consumes:
  - `RecordingSourceConfig`
  - `screenChunks` table
- Produces:
  - `DisplayCaptureHandle`
  - Cropped/composited chunks for `selected_area`

- [ ] **Step 1: Implement display stream acquisition**

Create:

```ts
'use client';

import { getClientDb } from '@/lib/db-client';
import type { RecordingSourceConfig } from '@/types/recording';

export interface DisplayCaptureHandle {
  sourceStream: MediaStream;
  recordedStream: MediaStream;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}

function mimeType(): string {
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  return 'video/webm';
}

export async function acquireDisplayStream(source: RecordingSourceConfig): Promise<MediaStream> {
  const video: MediaTrackConstraints & { displaySurface?: 'browser' | 'window' | 'monitor' } = {
    frameRate: { ideal: 30, max: 60 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(source.displaySurface ? { displaySurface: source.displaySurface } : {}),
  };
  const options = {
    video,
    audio: source.captureSystemAudio ? true : false,
    ...(source.kind === 'current_tab' ? { preferCurrentTab: true } : {}),
  } as DisplayMediaStreamOptions & { preferCurrentTab?: boolean };
  return navigator.mediaDevices.getDisplayMedia(options);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { rx: number; ry: number; rw: number; rh: number } | undefined,
  width: number,
  height: number,
): void {
  const vw = video.videoWidth || width;
  const vh = video.videoHeight || height;
  const source = crop
    ? { sx: crop.rx * vw, sy: crop.ry * vh, sw: crop.rw * vw, sh: crop.rh * vh }
    : { sx: 0, sy: 0, sw: vw, sh: vh };
  ctx.drawImage(video, source.sx, source.sy, source.sw, source.sh, 0, 0, width, height);
}

async function createSelectedAreaStream(
  sourceStream: MediaStream,
  source: RecordingSourceConfig,
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;
  await video.play();
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
    else video.onloadedmetadata = () => resolve();
  });

  const crop = source.sourceCropWindow;
  const cropAspect = crop
    ? (crop.rw * video.videoWidth) / (crop.rh * video.videoHeight)
    : video.videoWidth / video.videoHeight;
  const width = 1920;
  const height = Math.max(2, Math.round((width / cropAspect) / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  let raf = 0;
  const tick = () => {
    drawCover(ctx, video, crop, width, height);
    raf = requestAnimationFrame(tick);
  };
  tick();
  const stream = canvas.captureStream(30);
  return {
    stream,
    cleanup: () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    },
  };
}

export async function startDisplayCaptureRecorder(
  recordingId: string,
  source: RecordingSourceConfig,
  sourceStream: MediaStream,
): Promise<DisplayCaptureHandle> {
  const db = getClientDb();
  const selectedArea = source.kind === 'selected_area'
    ? await createSelectedAreaStream(sourceStream, source)
    : null;
  const recordedStream = selectedArea?.stream ?? sourceStream;
  const recorder = new MediaRecorder(recordedStream, {
    mimeType: mimeType(),
    videoBitsPerSecond: source.kind === 'selected_area' ? 4_000_000 : 6_000_000,
  });
  let chunkIndex = 0;
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      void db.screenChunks.add({ recordingId, index: chunkIndex++, blob: event.data });
    }
  };
  recorder.start(1000);
  return {
    sourceStream,
    recordedStream,
    pause: () => { if (recorder.state === 'recording') recorder.pause(); },
    resume: () => { if (recorder.state === 'paused') recorder.resume(); },
    stop: async () => {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        if (recorder.state !== 'inactive') recorder.stop();
      });
      selectedArea?.cleanup();
      sourceStream.getTracks().forEach((track) => track.stop());
    },
  };
}
```

- [ ] **Step 2: Add a selected-area storage invariant check**

The implementation must satisfy this invariant:

```text
selected_area screenChunks are recorded from canvas.captureStream(...)
and must not be raw chunks from the full getDisplayMedia stream.
```

Verify by inspecting `startDisplayCaptureRecorder`:

```bash
rg -n "source.kind === 'selected_area'|canvas.captureStream|new MediaRecorder\\(recordedStream" src/services/displayCaptureRecorder.ts
```

Expected:

```text
The command shows selected_area branching, canvas.captureStream, and MediaRecorder(recordedStream).
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run typecheck
```

Expected:

```text
exit 0
```

- [ ] **Step 4: Commit**

```bash
git add src/services/displayCaptureRecorder.ts
git commit -m "feat: add display capture recorder service"
```

---

## Task 9: Add Capture Source UI to Recording Setup

**Files:**
- Modify: `src/components/RecordingSetup.tsx`
- Modify: `src/messages/zh.json`
- Modify: `src/messages/en.json`

**Interfaces:**
- Produces:
  - `RecordingSetupConfig.source`

- [ ] **Step 1: Add source state**

```ts
const [source, setSource] = useState<RecordingSourceConfig>(
  initial.source ?? { kind: 'whiteboard' },
);
```

- [ ] **Step 2: Add source cards before aspect ratio**

Options:

```ts
[
  { kind: 'whiteboard', displaySurface: undefined },
  { kind: 'current_tab', displaySurface: 'browser', captureSystemAudio: true },
  { kind: 'window', displaySurface: 'window' },
  { kind: 'desktop', displaySurface: 'monitor' },
  { kind: 'selected_area', displaySurface: 'monitor' },
]
```

UI copy:

- Whiteboard: “Whiteboard / Best for drawing explanations”
- Current tab: “Current tab / Browser-controlled tab capture”
- Window: “Window / Record one app window”
- Desktop: “Desktop / Record an entire screen”
- Selected area: “Selected area / Choose a region after permission”

Important hint text:

```tsx
{source.kind !== 'whiteboard' && (
  <p>{t('source.browserChooserHint')}</p>
)}
```

Chinese:

```text
浏览器仍会显示系统选择器；这里的选项会作为采集提示和后续裁切方式。
```

English:

```text
The browser still shows its own picker. This choice controls the capture hint and later cropping behavior.
```

- [ ] **Step 3: Include source in handleStart config**

```ts
source,
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck
```

Expected:

```text
exit 0
```

- [ ] **Step 5: Commit**

```bash
git add src/components/RecordingSetup.tsx src/messages/zh.json src/messages/en.json
git commit -m "feat: add recording source picker"
```

---

## Task 10: Integrate Display Capture in Recording Session

**Files:**
- Modify: `src/services/recordingSession.ts`
- Modify: `src/app/[locale]/app/page.tsx`

**Interfaces:**
- Consumes:
  - `RecordingSetupConfig.source`
  - `startDisplayCaptureRecorder`
- Produces:
  - `screenChunks`
  - `RecordingMetadata.source`

- [ ] **Step 1: Extend `StartOptions`**

```ts
export interface StartOptions {
  withCamera: boolean;
  workspaceRoot?: HTMLElement | null;
  setup?: RecordingSetupConfig;
  audioStream?: MediaStream | null;
  cameraStream?: MediaStream | null;
  displayStream?: MediaStream | null;
}
```

- [ ] **Step 2: Start display recorder for non-whiteboard sources**

In `startRecording`, after metadata creation:

```ts
const source = opts.setup?.source ?? { kind: 'whiteboard' };
let display: DisplayCaptureHandle | null = null;
if (source.kind !== 'whiteboard' && opts.displayStream) {
  display = await startDisplayCaptureRecorder(recordingId, source, opts.displayStream);
  await db.recordings.update(recordingId, { source });
}
```

Import:

```ts
import { startDisplayCaptureRecorder, type DisplayCaptureHandle } from '@/services/displayCaptureRecorder';
```

- [ ] **Step 3: Pause/resume/stop display recorder**

In session handle:

```ts
pause() {
  if (paused) return;
  paused = true;
  pauseStartedAt = Date.now();
  audio?.pause();
  camera?.pause();
  display?.pause();
}
```

```ts
resume() {
  if (!paused) return;
  pausedTotal += Date.now() - pauseStartedAt;
  paused = false;
  audio?.resume();
  camera?.resume();
  display?.resume();
}
```

```ts
if (display) { try { await display.stop(); } catch { /* ignore */ } }
```

- [ ] **Step 4: Acquire display stream before countdown**

In `handleSetupConfirm`, if source is not whiteboard:

```ts
const source = config.source ?? { kind: 'whiteboard' };
if (source.kind !== 'whiteboard') {
  const stream = await acquireDisplayStream(source);
  setDisplayStream(stream);
}
```

Add state:

```ts
const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
const displayStreamRef = useRef<MediaStream | null>(null);
displayStreamRef.current = displayStream;
```

Pass into `startRecording`:

```ts
displayStream: displayStreamRef.current,
```

On cancel/stop/discard, stop display tracks and clear state.

- [ ] **Step 5: Track source analytics without renaming existing events**

Keep existing event names, add props:

```ts
trackEvent('recording_start', {
  framing: config.framing,
  withCamera: config.camera.enabled,
  withAudio: session.hasAudio,
  source: config.source?.kind ?? 'whiteboard',
});
```

- [ ] **Step 6: Verify**

Manual browser check:

- Whiteboard mode still records normally.
- Window mode opens browser picker.
- Cancelling picker returns to setup/framing without orphan streams.
- Stop recording writes `screenChunks`.

- [ ] **Step 7: Commit**

```bash
git add src/services/recordingSession.ts 'src/app/[locale]/app/page.tsx'
git commit -m "feat: record display capture sources"
```

---

## Task 11: Implement Selected-Area Framing for Display Capture

**Files:**
- Create: `src/components/DisplaySourceCropOverlay.tsx`
- Create: `src/components/DisplaySourcePreview.tsx`
- Modify: `src/app/[locale]/app/page.tsx`
- Modify: `src/types/recording.ts`

**Interfaces:**
- Consumes:
  - Display stream preview.
  - `RecordingSourceConfig.kind === 'selected_area'`
- Produces:
  - `RecordingSourceConfig.sourceCropWindow`
  - Selected-area recordings whose stored chunks are already cropped

- [ ] **Step 1: Add display preview video**

Create `src/components/DisplaySourcePreview.tsx`:

```tsx
'use client';

import { useEffect, useRef, type JSX } from 'react';

export function DisplaySourcePreview({ stream }: { stream: MediaStream }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        background: 'var(--paper-2)',
      }}
    />
  );
}
```

In `/app`, when `state === 'framing'` and `displayStream` exists:

```tsx
<DisplaySourcePreview stream={displayStream} />
```

It should be private and not included in whiteboard shell snapshots:

```tsx
<div className="rb-no-record">
  <DisplaySourcePreview stream={displayStream} />
</div>
```

- [ ] **Step 2: Add selected-area overlay**

`DisplaySourceCropOverlay` API:

```ts
interface Props {
  value: SourceCropWindow | null;
  onChange: (next: SourceCropWindow) => void;
}
```

Behavior:

- Default crop: centered 80% × 80%.
- Store normalized `rx/ry/rw/rh`.
- Enforce minimum size 10% × 10%.
- Use Craft-style blue outline, soft handles, no black hard border.
- The overlay coordinates must map to the preview video content box, not to the full browser window. This avoids recording black/empty letterbox space as part of the selected area.

- [ ] **Step 3: Persist selected-area crop into setup**

Before countdown:

```ts
const finalConfig = {
  ...setupConfig,
  source: setupConfig.source?.kind === 'selected_area'
    ? { ...setupConfig.source, sourceCropWindow }
    : setupConfig.source,
};
pendingStartRef.current = { config: finalConfig, pos: cameraPos, size: cameraSize };
```

- [ ] **Step 4: Verify**

Manual:

- Choose selected area.
- Grant desktop/window.
- Draw crop.
- Start recording.
- Metadata contains `setup.source.sourceCropWindow`.
- Exported and locally stored display chunks contain only the selected area.

- [ ] **Step 5: Commit**

```bash
git add src/components/DisplaySourceCropOverlay.tsx src/components/DisplaySourcePreview.tsx 'src/app/[locale]/app/page.tsx' src/types/recording.ts
git commit -m "feat: configure selected display area"
```

---

## Task 12: Render Display Capture in Preview and Export

**Files:**
- Create: `src/services/displayFrameSource.ts`
- Modify: `src/services/exportPipeline.ts`
- Modify: `src/components/ExportPreview.tsx`

**Interfaces:**
- Consumes:
  - `screenBlob`
  - `RecordingMetadata.source`
  - `ExportConfig.videoBackground`
- Produces:
  - Display-capture preview/export frames with background, crop, watermark, subtitles, camera overlay.

- [ ] **Step 1: Create display frame source helper**

`src/services/displayFrameSource.ts`:

```ts
'use client';

export interface DisplayFrameSource {
  video: HTMLVideoElement;
  ready: Promise<void>;
  seek: (timeMs: number) => Promise<void>;
  close: () => void;
}

export function createDisplayFrameSource(blob: Blob): DisplayFrameSource {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const ready = new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('display_video_load_failed'));
  });
  return {
    video,
    ready,
    seek: async (timeMs: number) => {
      await ready;
      const sec = Math.max(0, timeMs / 1000);
      if (Math.abs(video.currentTime - sec) < 0.035) return;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('display_video_seek_failed'));
        video.currentTime = sec;
      });
    },
    close: () => URL.revokeObjectURL(url),
  };
}
```

- [ ] **Step 2: Add display source branch to `renderPreviewFrame`**

If `screenBlob` exists:

1. Paint video background.
2. Seek display video to `timeMs`.
3. Draw display frame. For `selected_area`, do not apply `sourceCropWindow` again because the stored `screenChunks` are already cropped by `canvas.captureStream(...)`.
4. Draw watermark/subtitles.
5. Let `ExportPreview` camera overlay continue to draw camera video as current behavior.

Core drawing math:

```ts
function drawDisplayFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sourceKind: RecordingSourceKind,
  sourceCrop: SourceCropWindow | undefined,
  targetW: number,
  targetH: number,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const effectiveCrop = sourceKind === 'selected_area' ? undefined : sourceCrop;
  const crop = effectiveCrop
    ? {
        sx: effectiveCrop.rx * vw,
        sy: effectiveCrop.ry * vh,
        sw: effectiveCrop.rw * vw,
        sh: effectiveCrop.rh * vh,
      }
    : { sx: 0, sy: 0, sw: vw, sh: vh };
  const scale = Math.min(targetW / crop.sw, targetH / crop.sh);
  const dw = crop.sw * scale;
  const dh = crop.sh * scale;
  const dx = (targetW - dw) / 2;
  const dy = (targetH - dh) / 2;
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, dw, dh);
}
```

- [ ] **Step 3: Add display source branch to `exportRecording`**

For `screenBlob` recordings, use the same frame loop and encoder paths:

- `frameInputs(i)` maps output time to source time using segments.
- `composeFrame` paints background and display frame instead of Excalidraw snapshots.
- Camera, watermark, subtitle, audio, and trimming continue through existing branches.

Do not remove whiteboard path.

- [ ] **Step 4: Verify**

Manual:

- Record window source.
- Record selected-area source and confirm export does not include pixels outside the selected region.
- Export MP4 16:9.
- Change background in export panel.
- Change ratio to 9:16.
- Watermark/subtitles still draw.

- [ ] **Step 5: Commit**

```bash
git add src/services/displayFrameSource.ts src/services/exportPipeline.ts src/components/ExportPreview.tsx
git commit -m "feat: export display capture recordings"
```

---

## Task 13: Regression Tests and Visual QA

**Files:**
- Modify: `tests/e2e/upgrade.spec.ts` only if shared setup needs suppressing new intro/setup.
- Create: `tests/e2e/recording-background.spec.ts`
- Create: `tests/e2e/display-source.spec.ts`

**Interfaces:**
- Consumes complete feature.
- Produces e2e coverage for setup UI and no-crash flows.

- [ ] **Step 1: Add background setup smoke test**

Test flow:

```ts
test('recording setup can select a video background', async ({ page }) => {
  await page.goto('/zh/app');
  await page.evaluate(() => window.localStorage.setItem('excalicast.seenAppIntro', '1'));
  await page.getByRole('button', { name: /开始录制|Start recording/i }).click();
  await expect(page.getByText(/背景|Background/i)).toBeVisible();
  await page.getByRole('button', { name: /纸感蓝|Paper sky/i }).click();
  await expect(page.getByRole('button', { name: /纸感蓝|Paper sky/i })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Add display source picker smoke test**

Mock `getDisplayMedia` in Playwright:

```ts
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getDisplayMedia: async () => new MediaStream(),
      getUserMedia: async () => new MediaStream(),
    },
  });
});
```

Assert:

- Source options visible.
- Selecting window changes selected state.
- Cancelling setup leaves no crash.

- [ ] **Step 3: Run existing and new tests**

Run:

```bash
npm run typecheck
npm run build
E2E_BASE_URL=http://localhost:3017 npx playwright test tests/e2e/upgrade.spec.ts
```

Expected:

```text
typecheck exit 0
build exit 0
upgrade.spec.ts passes
```

- [ ] **Step 4: Manual visual QA**

Viewports:

- 1440×900
- 1280×720
- 390×844

Checklist:

- Setup modal does not feel like two design systems.
- Source picker and background picker use the same Craft border/radius/shadow vocabulary.
- Background selection remains readable in Chinese and English.
- Export preview and exported video show the same background.
- Current whiteboard recording path behaves exactly as before when background is `none` and source is `whiteboard`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/recording-background.spec.ts tests/e2e/display-source.spec.ts
git commit -m "test: cover background and display source setup"
```

---

## Recommended Execution Order

1. Video background data model and SVG assets.
2. Recording setup background picker.
3. Preview/export background rendering.
4. Export-side background adjustments.
5. Capture source model and DB table.
6. Display capture recording service.
7. Source picker UI.
8. Display capture preview/export.
9. Selected area crop.
10. Regression and visual QA.

This order keeps the existing whiteboard recording path stable while introducing one cross-cutting rendering feature at a time.

## Known Product/Browser Decisions

- “Current tab” is a hint, not a forced selection. Chromium supports `preferCurrentTab`; other browsers may ignore it.
- “Selected area” should be presented as “choose a source first, then crop the area inside Excalicast.” This is honest and browser-compatible.
- Selected-area recordings must store the cropped/composited canvas stream, not the raw granted display stream. This avoids retaining out-of-area pixels in IndexedDB.
- The first implementation stores display capture as WebM chunks in IndexedDB, parallel to audio/camera chunks, and reuses export-time rendering for ratio/background/watermark/subtitles.

## Out of Scope for This Plan

- Cloud sync schema expansion for screen chunks.
- Remote share playback for display-source recordings.
- Native app-level region capture.
- AI background generation.
- Theme switcher.
- Any payment or entitlement changes.
