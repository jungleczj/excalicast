# Excalicast SEO / GEO Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase qualified search traffic and AI-answer visibility for Excalicast as the browser-based Excalidraw / whiteboard recording workspace.

**Architecture:** Keep the current programmatic content architecture (`src/content/*`, `src/app/[locale]/*`, `src/lib/seo/*`) and add narrowly targeted pages, entity signals, crawl controls, and a repeatable GEO benchmark. Do not change recording, export, payment, cloud sync, or user data flows.

**Tech Stack:** Next.js App Router, next-intl, TypeScript content arrays, schema.org JSON-LD, Search Console CSV exports, public search / AI answer manual benchmarking.

## Global Constraints

- Do not modify API, database, hooks, recording/export/payment/cloud-sync logic for SEO work.
- Keep locale routing as `/zh/...` and `/en/...`.
- Maintain existing ISR / SSG behavior for marketing and content pages.
- Keep `llms.txt`, `robots.txt`, `sitemap.xml`, canonical, hreflang, JSON-LD, and OpenGraph consistent with visible page text.
- Google AI Overviews / AI Mode use normal Search eligibility; there is no special schema or AI-only file required for Google AI features.
- Treat `llms.txt` as useful for AI crawlers that read it, not as a replacement for crawlable, visible, helpful content.

---

## Current Data Snapshot

Source files:

- `/Users/chenzhijiang/Downloads/excalicast.cc_KeywordReport_7_22_2026.csv`
- `/Users/chenzhijiang/Downloads/excalicast.cc_PageTrafficReport_7_22_2026.csv`

### Search Console keyword summary

- Total keyword impressions: `247`
- Total keyword clicks: `22`
- Blended keyword CTR: `8.91%`
- Dominant query family: `excalicord` / `excalicord 白板`
  - `excalicord`: `102` impressions, `5` clicks, `4.9%` CTR, avg position `3.20`
  - `excalicord 白板`: `96` impressions, `9` clicks, `9.38%` CTR, avg position `2.68`
  - Combined: `198 / 247` impressions (`80.2%`) and `14 / 22` clicks (`63.6%`)
- Strong early non-brand signals:
  - `excalidraw可以录视频`: avg position `4.00`
  - `白板录视频`: avg position `5.50`
  - `屏幕录制 白板`: avg position `3.50`
  - `白板录视频工具`: avg position `1.00`
  - `画板写字讲解录制`: avg position `1.00`
  - `whiteboard math video recording tips`: avg position `1.00`

### Search Console page summary

- Total page impressions: `266`
- Total page clicks: `22`
- Blended page CTR: `8.27%`
- `/zh` owns nearly all traffic:
  - `https://excalicast.cc/zh`: `248` impressions, `22` clicks, `8.87%` CTR, avg position `2.93`
  - This is `93.2%` of all page impressions and `100%` of clicks.
- Content pages have early impressions but zero clicks:
  - `/zh/use-cases/record-whiteboard-lecture`: position `7.25`
  - `/zh/use-cases`: position `9.00`
  - `/zh/compare/excalicast-vs-excalidraw`: position `6.50`
  - `/zh/blog/one-recording-every-aspect-ratio`: position `6.00`
  - `/zh/blog/record-whiteboard-without-screen-recording`: position `6.00`

### Public search observation

- Exact brand search is not fully clean: `excalicast.com` appears as a competing “ExcaliCast” iOS product, while `excalicast.cc/en` also appears.
- Broad English whiteboard-recorder queries surface competitors such as Screency, ExcaliRec, Explideo, Whiteboard Recorder, YoRecord, Screenity, ClearRec, and ReClyp.
- Broad Chinese whiteboard-recorder queries surface Chinese education/recording tools and sometimes Excalicast English pages, not consistently the intended Chinese pages.
- `excalicord.com` is indexed externally as “Excalicord - Record Whiteboard Videos”; if this is a legacy/owned domain, it should be redirected or explicitly consolidated.

## Current Project SEO / GEO Strengths

- SSG / ISR content architecture already exists.
- Sitemap enumerates locale-specific marketing and content routes.
- Canonical + hreflang helper exists in `src/lib/seo/alternates.ts`.
- Programmatic content exists for use cases, blog, compare pages.
- JSON-LD builders exist for `SoftwareApplication`, `Organization`, `FAQPage`, and breadcrumbs.
- `/llms.txt` exists and summarizes the product for AI crawlers.
- Landing page has visible FAQ content and strong product positioning.

## Current Project SEO / GEO Gaps

- `robots.ts` disallows `/app`, `/library`, `/s/`, but real localized paths are `/zh/app`, `/en/app`, `/zh/library`, `/en/library`, `/zh/s/`, `/en/s/`. Search Console already shows `/zh/app` impressions, so crawl controls are incomplete.
- `organizationSchema()` points `logo` at `${SITE_URL}/en/icon.png`, but app icon routes are top-level `/icon.png` and `/apple-icon.png`; the entity logo URL should be fixed.
- Search snippets show duplicate branding on legal pages, e.g. `Refund Policy · Excalicast · Excalicast`.
- Content-page traffic is too concentrated on `/zh`; internal links and page-level snippets are not yet pulling users into use-case / compare / blog pages.
- Brand/entity ambiguity is high: `Excalicast`, `ExcaliCast`, `Excalicord`, and `ExcaliRec` all appear in the search surface.
- AI-answer readiness is good structurally, but lacks enough external corroboration, comparisons, examples, and “answerable” pages for query fan-out.

---

## 20-Question GEO Benchmark Set

Run these prompts against four surfaces:

1. ChatGPT with search enabled
2. Gemini
3. Google AI Overview / AI Mode where available
4. Perplexity

Scoring:

- `1.0`: Excalicast appears as a recommended option with correct name and either a link or clearly attributable source.
- `0.5`: Excalicast is mentioned but not recommended, no link, or appears only after several competitors.
- `0`: Excalicast absent.
- `-1 flag`: Wrong product is recommended as Excalicast, such as `excalicast.com`, `Excalicord`, or `ExcaliRec`.

Record:

- Platform
- Prompt
- Locale
- Was Excalicast included?
- Rank position among tools if list exists
- Exact cited URL
- Wrong-brand confusion
- Competitors included
- Missing feature claim or hallucination
- Notes for content needed

### English prompts

1. What is the best tool to record an Excalidraw whiteboard as a video with voice?
2. How can I record an Excalidraw canvas without using screen recording?
3. Which browser-based whiteboard recorder can export MP4 with webcam and microphone?
4. What is a good Loom alternative for whiteboard explainer videos?
5. How do I turn one whiteboard recording into 16:9 and 9:16 videos?
6. Which whiteboard recorder is best for online teachers who need subtitles?
7. What tool should a software architect use to record an async system-design walkthrough?
8. How can I record a math tutorial on a whiteboard and publish it to YouTube?
9. What local-first whiteboard recording tool keeps recordings on my device?
10. Which tools can record a whiteboard and generate captions, outlines, and handouts?

### Chinese prompts

11. Excalidraw 怎么录制成视频并带上语音？
12. 有没有在线白板录视频工具，能直接导出 MP4？
13. 白板讲课录制后怎么自动生成字幕？
14. 有什么适合录制数学讲题的白板录制工具？
15. 如何把一次白板录制同时导出横屏和竖屏？
16. Loom 有没有更适合白板讲解的替代工具？
17. 录制架构图讲解，怎么避免窗口遮挡被录进去？
18. 哪个工具可以在浏览器里录白板、剪辑、加字幕、再发布？
19. 白板录制内容怎么归档成可以搜索的素材？
20. Excalidraw 白板讲解如何录制、剪辑并分发到多个平台？

Expected first baseline:

- ChatGPT/Gemini/Perplexity/G-AIO true answer-rate cannot be measured without either interactive account access or approved API/browser access.
- Public web retrieval already suggests low-to-moderate category visibility: Excalicast appears for some whiteboard-recorder queries, but competitors frequently rank above it.
- Initial success target after Phase 1: Excalicast appears in at least `8 / 20` prompts on one searchable answer surface, with zero wrong-brand recommendations.
- 90-day target: at least `40%` weighted visibility across the 80 platform-prompt checks, and top-3 tool placement in at least `6` high-intent prompts.

---

## Task 1: Fix Crawl Controls and Entity Signals

**Files:**

- Modify: `src/app/robots.ts`
- Modify: `src/lib/seo/schema.ts`
- Modify: legal page metadata if duplicate titles are emitted from `src/app/[locale]/refund/page.tsx`, `src/app/[locale]/privacy/page.tsx`, `src/app/[locale]/terms/page.tsx`
- Test: `tests/e2e/seo-routes.spec.ts`

**Interfaces:**

- Consumes: `SITE_URL` from `src/lib/seo/alternates.ts`
- Produces: correct `/robots.txt`, valid `Organization.logo`, non-duplicated titles

- [ ] Add localized private-route disallows:
  - `/zh/app`, `/en/app`
  - `/zh/library`, `/en/library`
  - `/zh/s/`, `/en/s/`
  - Keep marketing/content pages crawlable.

- [ ] Decide whether `/library` should ever be SEO-visible:
  - If no: add `robots: { index: false, follow: false }` metadata to localized library page and keep it out of sitemap.
  - If yes later: create a public “recording library product page” under marketing, not the private app library.

- [ ] Fix `organizationSchema().logo` to a real top-level asset:
  - Preferred: `${SITE_URL}/brand/excalicast-logo.svg` if deployed.
  - Fallback: `${SITE_URL}/icon.png`.

- [ ] Fix legal-page title duplication:
  - Page metadata title should be either `absolute: "Refund Policy · Excalicast"` or child title `"Refund Policy"` under the layout template, not both.

- [ ] Add an E2E SEO route test:
  - Fetch `/robots.txt` and assert localized app/library/share routes are disallowed.
  - Fetch `/sitemap.xml` and assert private routes are not present.
  - Render landing HTML and assert `Organization.logo` points to an existing top-level URL.

## Task 2: Brand Consolidation and Disambiguation

**Files:**

- Modify: `src/messages/en.json`
- Modify: `src/messages/zh.json`
- Modify: `src/app/llms.txt/route.ts`
- Modify: `src/content/compare.ts`
- Optional create: `src/content/blog.ts` entry for brand/entity clarification if needed

**Interfaces:**

- Consumes: Search Console misspellings and public search ambiguity
- Produces: consistent “Excalicast” entity facts and safe disambiguation

- [ ] Audit ownership of `excalicord.com`.
  - If owned: 301 redirect `excalicord.com/*` to `https://excalicast.cc/en` or the matching locale if known.
  - If not owned: do not create misleading copy; use neutral entity language only.

- [ ] Add a short brand/entity paragraph to `llms.txt`:
  - Canonical name: `Excalicast`
  - Canonical domain: `https://excalicast.cc`
  - Category: browser-based whiteboard recorder built around Excalidraw-style canvas recordings
  - Not a generic screen recorder; strongest for whiteboard / diagram explainers

- [ ] Add visible landing FAQ or content-page FAQ only if factually safe:
  - “Is Excalicast the same as ExcaliRec or ExcaliCast?”
  - Answer must avoid attacking competitors and simply state the product/domain distinction.

- [ ] Add comparison coverage where search results already confuse users:
  - `excalicast-vs-excalidraw`
  - `excalicast-vs-excalirec`
  - `excalicast-vs-screenity`
  - `excalicast-vs-screency`

## Task 3: Capture High-Intent Chinese Queries

**Files:**

- Modify: `src/content/use-cases.ts`
- Modify: `src/content/blog.ts`
- Modify: `src/content/compare.ts`
- Modify: `src/components/content/RelatedLinks.tsx` if internal links need stronger routing

**Interfaces:**

- Consumes: CSV keyword rows with Chinese query intent
- Produces: Chinese pages that answer the query in the first paragraph

- [ ] Create or strengthen a Chinese page for `Excalidraw 怎么录制视频`.
  - H1 direction: `Excalidraw 怎么录制成带语音的视频`
  - First paragraph must answer in one sentence: open Excalicast, record canvas actions + microphone, then export MP4.
  - Include exact phrases: `Excalidraw 录制视频`, `白板录视频`, `导出 MP4`, `无需录屏`.

- [ ] Create or strengthen a Chinese page for `白板录视频工具`.
  - Compare operation-stream recording vs normal screen recording.
  - Include use cases: 讲课、数学讲题、架构图、产品流程、短视频分发.

- [ ] Create or strengthen a Chinese page for `白板讲课录制 自动字幕`.
  - Explain Pro subtitles, SRT download, burned-in captions, privacy boundary.
  - Avoid overclaiming transcription accuracy.

- [ ] Add stronger internal links from homepage FAQ and footer to:
  - `/zh/use-cases/record-whiteboard-lecture`
  - `/zh/use-cases/record-math-tutorial`
  - `/zh/blog/record-whiteboard-without-screen-recording`
  - `/zh/compare/excalicast-vs-excalidraw`

## Task 4: Capture English Category Queries

**Files:**

- Modify: `src/content/use-cases.ts`
- Modify: `src/content/blog.ts`
- Modify: `src/content/compare.ts`

**Interfaces:**

- Consumes: public search competitor set and existing English content
- Produces: AI-answer-friendly pages with concise facts, comparisons, and limitations

- [ ] Strengthen “record Excalidraw to video” coverage:
  - Dedicated page intro: “To record Excalidraw to video, use Excalicast to capture canvas operations plus microphone audio, then export MP4 in the ratio you need.”
  - Include “when this is better than screen recording” and “when a normal screen recorder is better.”

- [ ] Strengthen “Loom alternative for whiteboard explainers” coverage:
  - Keep Loom comparison factual.
  - Add side-by-side rows: capture method, occlusion, aspect ratios, captions, privacy, signup.

- [ ] Strengthen “local-first whiteboard recorder” coverage:
  - Explain IndexedDB, local rendering, and which opt-in features use network.
  - Link to privacy policy.

- [ ] Add “not for” sections:
  - Not for full multi-window app demo recording.
  - Not for live collaborative classroom sessions.
  - Not for full cloud video hosting unless using share links.

## Task 5: GEO Content Format Upgrade

**Files:**

- Modify: content entries in `src/content/*`
- Modify: `src/components/content/ContentPieces.tsx`
- Modify: `src/components/content/ContentShell.tsx`

**Interfaces:**

- Consumes: 20 benchmark prompts
- Produces: pages whose text can be lifted by AI answers without hallucination

- [ ] Every strategic page starts with a direct answer block:
  - `The short answer: ...`
  - Chinese equivalent: `简短答案：...`

- [ ] Add “Best for / Not best for” blocks to compare and use-case pages.

- [ ] Add factsheets on key pages:
  - Product category
  - Input
  - Output
  - Storage/privacy
  - Export formats
  - Pricing boundary
  - Who should use it

- [ ] Ensure JSON-LD matches visible text exactly.

- [ ] Add concrete screenshots/video thumbnails where relevant; Google AI guidance still values high-quality images/videos when they support textual content.

## Task 6: GEO Benchmark Runner

**Files:**

- Create: `docs/geo/benchmark-prompts-2026-07-22.md`
- Create: `docs/geo/benchmark-results-template.csv`
- Optional create: `scripts/geo-scorecard.mjs`

**Interfaces:**

- Consumes: the 20 prompts above
- Produces: repeatable monthly scorecard

- [ ] Create a benchmark prompt file containing the 20 prompts and scoring rubric.

- [ ] Create a CSV template with columns:
  - `date`
  - `platform`
  - `prompt_id`
  - `locale`
  - `excalicast_score`
  - `rank_position`
  - `cited_url`
  - `wrong_brand_flag`
  - `competitors`
  - `answer_excerpt`
  - `content_gap`
  - `notes`

- [ ] For manual measurement:
  - Run each prompt in ChatGPT Search, Gemini, Google AI Overview / AI Mode, and Perplexity.
  - Paste exact result snippets and links into the CSV.
  - Count weighted score: sum scores / 80.

- [ ] For automated measurement later:
  - Use APIs only where accounts and terms allow.
  - Keep manual Google AI Overview checks because availability varies by region, account, and query.

## Task 7: Indexing and Recrawl Operations

**Files:**

- Optional create: `scripts/submit-indexnow.mjs`
- Optional create: public IndexNow key file if using IndexNow
- Update: deployment checklist

**Interfaces:**

- Consumes: new/updated content URLs
- Produces: faster discovery by Bing/participating engines and clean Search Console recrawl workflow

- [ ] Submit updated sitemap in Google Search Console and Bing Webmaster Tools.

- [ ] Use URL Inspection for priority pages:
  - `/zh`
  - `/zh/use-cases/record-whiteboard-lecture`
  - `/zh/compare/excalicast-vs-excalidraw`
  - `/en`
  - `/en/blog/record-whiteboard-without-screen-recording`

- [ ] Add IndexNow only after choosing a persistent key and deploying the key file.

- [ ] Track weekly:
  - Indexed pages
  - Impressions by page
  - Non-brand impressions
  - CTR of `/zh`
  - Clicks to use-case/compare/blog pages
  - AI-answer benchmark weighted score

## Priority Order

1. P0 technical cleanup: localized robots disallow, logo schema URL, duplicate legal titles.
2. P0 brand consolidation: `excalicord`/`excalicast` ambiguity and entity facts.
3. P1 Chinese high-intent pages: `Excalidraw 录制视频`, `白板录视频工具`, `自动字幕`.
4. P1 English category pages: Excalidraw video, Loom alternative, local-first, multi-ratio export.
5. P2 GEO format upgrade: direct answers, best/not-best, factsheets, visible Q&A.
6. P2 GEO benchmark runner and monthly scorecard.
7. P3 external authority: directory submissions, Excalidraw ecosystem references, creator demos, documentation backlinks.

## Acceptance Criteria

- Search Console after 28 days:
  - Non-brand impressions increase by at least `50%`.
  - Use-case/compare/blog pages together get at least `25%` of impressions, up from about `6.8%`.
  - `/zh/app` and other private app routes disappear from indexable-page reports if intentionally noindexed/disallowed.
- GEO benchmark after 28 days:
  - Excalicast appears in at least `8 / 20` prompts on at least one answer surface.
  - Wrong-brand confusion rate is below `10%`.
- GEO benchmark after 90 days:
  - Weighted visibility across 80 checks reaches at least `40%`.
  - Excalicast is top-3 in at least `6` high-intent prompts.

## References

- Google Search Central: AI features use normal Search eligibility; important content must be crawlable, internally linked, visible as text, and structured data must match visible content.
- Google Search Central: Helpful content should provide original, complete, reliable, people-first value.
- OpenAI crawler docs: allow `OAI-SearchBot` for ChatGPT search visibility; `GPTBot` is separate from search/training.
- Perplexity crawler docs: allow `PerplexityBot` for Perplexity search visibility; `Perplexity-User` supports user-triggered retrieval.
- IndexNow docs: after setup, changed URLs can be submitted by GET/POST and shared with participating search engines.
