# Key Point Caption Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate every key point motion track in the dominant language of its subtitle cues, independent of the export page locale.

**Architecture:** Add one deterministic subtitle-language resolver to the key-point domain and reuse it at both trust boundaries. The export page uses the result for task metadata, remote generation, and local fallback; the API recomputes it from validated cues before building the prompt or parsing the model response.

**Tech Stack:** TypeScript, Next.js App Router, Playwright test runner.

## Global Constraints

- The complete key-point track uses one dominant subtitle language.
- Page locale controls UI copy only.
- The API must not trust a client locale when subtitle content is detectable.
- No new language model or package is added.
- Update both `docs/development-log.md` and `docs/bug-log.md`.

---

### Task 1: Subtitle language resolver

**Files:**
- Modify: `tests/e2e/media-pipeline.spec.ts`
- Modify: `src/services/keyPointMotion.ts`

**Interfaces:**
- Produces: `resolveKeyPointMotionLanguage(cues: SubtitleCue[], fallback?: 'en' | 'zh'): 'en' | 'zh'`

- [ ] **Step 1: Write failing tests**

Add table-driven cases proving Chinese subtitles resolve to `zh`, English subtitles resolve to `en`, mixed subtitles resolve to their dominant meaningful script, and non-linguistic input uses the explicit fallback.

- [ ] **Step 2: Verify RED**

Run: `npx playwright test tests/e2e/media-pipeline.spec.ts --grep "key point language" --reporter=list`

Expected: FAIL because `resolveKeyPointMotionLanguage` is not exported.

- [ ] **Step 3: Implement the resolver**

Count Han characters and Latin words from normalized cue text. Resolve Chinese when the Han signal exceeds the Latin-word signal, English when Latin words exceed Han, and use the fallback only when no meaningful signal exists.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2 and expect all language cases to pass.

### Task 2: End-to-end generation language

**Files:**
- Modify: `src/app/[locale]/export/[id]/page.tsx`
- Modify: `src/app/api/key-points/generate/route.ts`
- Modify: `src/services/keyPointMotionClient.ts`
- Modify: `src/services/keyPointMotionPrompt.ts`
- Modify: `tests/e2e/media-pipeline.spec.ts`

**Interfaces:**
- Consumes: `resolveKeyPointMotionLanguage(cues, fallback)`
- Produces: a request and local fallback that use the same resolved subtitle language.

- [ ] **Step 1: Write failing behavior tests**

Assert that prompt construction resolves Chinese output for Chinese cues even with an English hint, and English output for English cues even with a Chinese hint. Assert local fallback output follows the same resolved language.

- [ ] **Step 2: Verify RED**

Run the focused language tests and confirm they fail because the existing locale argument overrides subtitle content.

- [ ] **Step 3: Connect the resolver**

Resolve language in the export page before task creation. Send it as a hint, use it for local fallback, and expose it in the task snapshot. In the API, recompute language from validated cues and use that value for `buildKeyPointMotionPrompt` and `parseKeyPointMotionResponse`.

- [ ] **Step 4: Verify GREEN**

Run the focused tests and the complete `tests/e2e/media-pipeline.spec.ts` suite.

### Task 3: Documentation and release verification

**Files:**
- Modify: `docs/development-log.md`
- Modify: `docs/bug-log.md`

**Interfaces:**
- Documents the language source, previous root cause, test evidence, and compatibility behavior.

- [ ] **Step 1: Update logs**

Record that key-point language previously followed the route locale and now follows the dominant complete subtitle track on both client and server.

- [ ] **Step 2: Run verification**

Run:

```bash
npm run typecheck
npx playwright test tests/e2e/media-pipeline.spec.ts --reporter=list
npm run build
```

- [ ] **Step 3: Inspect the final diff**

Run `git diff --check` and confirm only the planned key-point language files and logs changed.

