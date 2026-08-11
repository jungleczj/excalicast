# Web Key-Point Drawer Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace copied-caption cards with DeepSeek-generated chapter and short-key-point drawers in the Web export editor.

**Architecture:** Keep `KeyPointMotionSegment` as the durable timeline unit, migrate it to schema v2 drawer kinds, and isolate generation, validation, media-time animation, and Canvas rendering. A Pro-authenticated API sends captions only to DeepSeek; preview and export reuse the same pure renderer.

**Tech Stack:** Next.js App Router, TypeScript, Canvas 2D, DeepSeek JSON Output, IndexedDB/Dexie, Playwright.

## Global Constraints

- Work only in `/Users/chenzhijiang/.codex/worktrees/53c2/pro` on `codex/recovered-53c2`.
- Web only; do not modify either macOS worktree.
- Do not upload audio or video for key-point generation.
- B is used at chapter openings and C at meaningful interior points.
- Directional drawers enter and exit through their own edge; every line reveals word by word from below.
- Update both `docs/development-log.md` and `docs/bug-log.md`.

---

### Task 1: Generation contract and compatibility

**Files:**
- Modify: `src/types/recording.ts`
- Modify: `src/services/keyPointMotionSchema.ts`
- Modify: `src/services/keyPointMotion.ts`
- Modify: `src/lib/db-client.ts`
- Test: `tests/e2e/media-pipeline.spec.ts`

**Interfaces:**
- Produces: schema-v2 `KeyPointMotionSegment`, `parseKeyPointMotionResponse(raw, cues, durationMs, locale)`, and `migrateKeyPointMotionSegment(segment)`.

- [ ] Add failing tests for B/C mapping, 2-5-character Chinese points, English limits, duplicate rejection, evidence-cue clamping, and schema-v1 migration.
- [ ] Run `npx playwright test tests/e2e/media-pipeline.spec.ts -g "key point"` and confirm the new assertions fail.
- [ ] Add `chapter_drawer | key_points_drawer`, schema version 2, short-phrase normalization, and deterministic local fallback.
- [ ] Persist only sanitized v2 segments while preserving old recordings through migration.
- [ ] Re-run focused media tests and confirm they pass.

### Task 2: DeepSeek chapter and key-point generation

**Files:**
- Create: `src/services/keyPointMotionPrompt.ts`
- Create: `src/services/keyPointMotionClient.ts`
- Create: `src/app/api/key-points/generate/route.ts`
- Test: `tests/e2e/key-point-generation.spec.ts`

**Interfaces:**
- Consumes: caption cues `{ index, startMs, endMs, text }`, `durationMs`, and `locale`.
- Produces: `{ motions: KeyPointMotionSegment[], model: string, source: 'deepseek' }` or a structured API error.

- [ ] Add route tests for authentication, Pro entitlement, input limits, prompt contract, JSON validation, and sanitized output.
- [ ] Build a fixed system prompt that asks for JSON chapters, B opening moments, C interior moments, short semantic phrases, and source cue evidence; include a valid example.
- [ ] Call `deepseekChat` in JSON mode with captions only and parse through the shared schema.
- [ ] Add an abortable client and connect the editor action; on network/service failure, generate the explicit local fallback without deleting the previous track.
- [ ] Run route and editor interaction tests.

### Task 3: Directional drawer and word reveal renderer

**Files:**
- Modify: `src/services/keyPointMotion.ts`
- Modify: `src/services/editorEffectsRenderer.ts`
- Test: `tests/e2e/media-pipeline.spec.ts`

**Interfaces:**
- Produces: `tokenizeKeyPointLine(text, locale)`, `resolveKeyPointDrawerState(segment, timeMs, tokenCount)`, and the updated shared `drawKeyPointMotion`.

- [ ] Add failing state and pixel assertions for full-height right/left gradients, full-width top/bottom gradients, same-edge entry/exit, and staggered token reveal.
- [ ] Implement placement vectors and gradient stops in recording-frame coordinates.
- [ ] Tokenize Chinese with `Intl.Segmenter` plus a grapheme fallback and English by words; calculate per-token opacity and vertical offset from media time.
- [ ] Render B hierarchy and C keyword stacks in white type without a rounded card, clipped to the fixed video frame.
- [ ] Verify identical renderer use in preview and final export paths.

### Task 4: Timeline editing, persistence, and regression coverage

**Files:**
- Modify: `src/components/editor/Timeline.tsx`
- Modify: `src/app/[locale]/export/[id]/page.tsx`
- Modify: `tests/e2e/editor-interactions.spec.ts`
- Modify: `docs/development-log.md`
- Modify: `docs/bug-log.md`

**Interfaces:**
- Consumes: schema-v2 motions and generation states.
- Produces: editable B/C kind, placement, title, short key-point lines, failure/fallback status, and durable timeline changes.

- [ ] Add failing E2E coverage for AI generation, local fallback, B/C editors, right-edge direction, persistence, replacement confirmation, and preserving the old track on failure.
- [ ] Replace legacy layout labels with Chapter drawer and Key-point drawer and enforce short phrase limits in the editor.
- [ ] Surface generation errors and local fallback status without blocking unrelated editor controls.
- [ ] Update feature and bug logs with user value, root cause, implementation, and verification.
- [ ] Run `npm run typecheck`, focused Playwright tests, full media/editor suites, and `npm run build`.

