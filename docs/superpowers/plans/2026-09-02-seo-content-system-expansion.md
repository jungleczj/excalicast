# SEO Content System Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Excalicast from 10 to roughly 25–30 bilingual blog posts, backed by at least 50 qualified US keywords, a Top 10 competitor content-and-layout audit, stronger article presentation, original visuals, and a complete search-engine submission URL manifest.

**Architecture:** Keep `src/content/blog.ts` as the public aggregator while splitting authored entries into focused cluster modules under `src/content/blog/`. Extend `BlogEntry` with structured media, tables, callouts, checklists, cluster metadata, and reading-time support; render those through dedicated server components so old posts remain compatible. Research artifacts and URL manifests remain versioned CSV/Markdown files and act as the source of truth for page production.

**Tech Stack:** Next.js 14 App Router, React Server Components, TypeScript, next-intl, Playwright Test, CSS in `src/app/globals.css`, SEMrush US database, Chrome/browser research, built-in ImageGen, static bilingual content data.

**Spec:** `docs/superpowers/specs/2026-09-02-seo-content-system-expansion-design.md`

## Global Constraints

- US English search data is the keyword baseline; every published page ships in English and Chinese.
- Produce at least 50 qualified keywords and 15–20 net-new blog slugs.
- Upgrade the five named core articles to 1,400–2,200 English words, 5–8 body H2s, at least three FAQs, at least three sources, at least two original visual assets, and at least one structured decision aid.
- Search titles are 45–58 characters; the lead answers the query in 40–70 English words.
- Each paragraph carries one idea and stays at or below roughly 240 characters where natural sentence boundaries permit.
- Humor appears two to four times per long article, never mocks users or competitors, and never replaces factual guidance.
- Real product UI uses real project screenshots. HTML/CSS or SVG handles deterministic diagrams. ImageGen is reserved for editorial illustration and never impersonates product or competitor UI.
- Generated assets are copied into `public/blog/<slug>/`; all assets have bilingual alt text, visible captions, dimensions, source kind, and no sensitive information.
- Highly overlapping keyword variants share one authoritative page. No doorway pages, keyword stuffing, copied competitor text, copied competitor imagery, or unsupported product claims.
- Every new slug appears in the bilingual sitemap, internal linking graph, and full canonical URL submission manifest.
- Use `apply_patch` for repository edits, preserve unrelated user changes, and follow red-green-refactor for code and behavior changes.

---

## File Structure

### Research and delivery artifacts

- Create `docs/seo/competitor-content-system-audit-2026-09-02.md` — Top 10 content architecture and page-layout matrix.
- Create `docs/seo/keyword-expansion-2026-09-02.csv` — raw qualified keyword evidence.
- Create `docs/seo/content-cluster-map-2026-09-02.csv` — one row per keyword with its chosen primary page.
- Create `docs/seo/visual-asset-manifest-2026-09-02.csv` — screenshot/diagram/ImageGen provenance.
- Create `docs/seo/indexing-url-manifest-2026-09-02.csv` — full bilingual canonical URLs for manual submission.
- Modify `docs/development-log.md` — research, implementation, and verification record.

### Content model and rendering

- Modify `src/content/types.ts` — structured blog types and cluster metadata.
- Modify `src/content/blog.ts` — aggregate cluster modules, apply shared author/source/update defaults, expose lookup helpers.
- Create `src/content/blog/legacy.ts` — unchanged pre-September articles.
- Create `src/content/blog/platform.ts` — device, browser, audio, and camera articles.
- Create `src/content/blog/whiteboard.ts` — whiteboard, animation, storyboard, and explainer articles.
- Create `src/content/blog/publishing.ts` — captions, notes, editing, aspect ratios, and repurposing articles.
- Create `src/content/blog/workflows.ts` — teaching, product demo, architecture, and team-workflow articles.
- Create `src/components/content/BlogArticleBody.tsx` — TOC and structured block orchestration.
- Create `src/components/content/BlogMediaFigure.tsx` — accessible image/figure rendering.
- Create `src/components/content/BlogDecisionTable.tsx` — responsive comparison and decision tables.
- Create `src/components/content/BlogCallout.tsx` — answer/tip/warning/reality-check cards.
- Modify `src/app/[locale]/blog/[slug]/page.tsx` — reading metadata, structured body, FAQ schema, and asset URLs.
- Modify `src/app/[locale]/blog/page.tsx` — cluster navigation and grouped article index.
- Modify `src/app/globals.css` — readable two-column article shell, sticky TOC, mobile collapse, tables, figures, and callouts.

### Tests

- Create `tests/e2e/seo-content-quality.spec.ts` — static research/content quality contracts.
- Create `tests/e2e/blog-reading-experience.spec.ts` — rendered desktop/mobile article layout and schema checks.
- Modify `tests/e2e/seo-routes.spec.ts` — new cluster coverage, sitemap URLs, and no-cannibalization assertions.

---

### Task 1: Audit the First Five Competitor Content Systems

**Files:**
- Create: `docs/seo/competitor-content-system-audit-2026-09-02.md`

**Interfaces:**
- Consumes: SEMrush Organic Rankings/Top Pages and the public sites for Loom, ScreenPal, ScreenRec, Bandicam, and Screencastify.
- Produces: audit rows with the exact columns consumed by Task 3: `brand`, `content_hubs`, `page_types`, `top_page_patterns`, `layout_patterns`, `voice_patterns`, `internal_linking`, `conversion_pattern`, `borrow`, `avoid`, `verified_at`.

- [ ] **Step 1: Create the audit matrix header and scoring rubric**

Add a Markdown table with the interface columns and a rubric scoring each brand from 1–5 for search-intent coverage, evidence, scanability, personality, internal linking, and conversion clarity.

- [ ] **Step 2: Record Loom and ScreenPal**

Inspect navigation, blog/category pages, at least five high-traffic content URLs per brand, one mobile article view, and one conversion page. Record title pattern, H2 pattern, media density, TOC, FAQ, sources, related links, and CTA placement.

- [ ] **Step 3: Record ScreenRec and Bandicam**

Repeat the same fields, explicitly noting how their strong screen-recorder pages combine product copy with tutorial intent.

- [ ] **Step 4: Record Screencastify**

Capture its education/Chrome distribution model, teacher-oriented content paths, article layout, and how blog pages return visitors to product activation.

- [ ] **Step 5: Verify the first five rows are complete**

Run:

```bash
rg '^\| (Loom|ScreenPal|ScreenRec|Bandicam|Screencastify) \|' docs/seo/competitor-content-system-audit-2026-09-02.md
```

Expected: exactly five populated brand rows with `2026-09-02` verification dates.

- [ ] **Step 6: Commit**

```bash
git add docs/seo/competitor-content-system-audit-2026-09-02.md
git commit -m "docs(seo): audit screen recording content leaders"
```

### Task 2: Complete the Top 10 Audit and Extract Shared Patterns

**Files:**
- Modify: `docs/seo/competitor-content-system-audit-2026-09-02.md`

**Interfaces:**
- Consumes: Task 1 audit schema plus SEMrush/public-site evidence for VEED, Screen Studio, VideoScribe, Canva, and Powtoon.
- Produces: a complete 10-brand matrix and a ranked `Shared patterns to implement` section referenced by Tasks 5 and 6.

- [ ] **Step 1: Record VEED and Screen Studio**

Separate VEED's utility/tool-led content model from Screen Studio's visually led product-site model. Record what each proves above the fold and how many steps separate article reading from product use.

- [ ] **Step 2: Record VideoScribe, Canva, and Powtoon**

Focus on category-definition pages, templates, examples, visual storytelling, animated explainer content, and repeated conversion modules.

- [ ] **Step 3: Write the shared content-system pattern**

Rank patterns under these headings: hub-and-spoke structure, device/how-to pages, free utilities, comparison content, template/example content, freshness/provenance, internal links, and conversion paths.

- [ ] **Step 4: Write the shared layout pattern**

Specify Excalicast's adopted layout: direct-answer hero, visual proof, key takeaways, desktop sticky TOC, mobile disclosure TOC, short paragraphs, decision aids, reality-check callouts, FAQ, sources, related cluster, and intent-specific CTA.

- [ ] **Step 5: Write the voice pattern**

Include five reusable tone rules and ten example transitions split evenly between English and Chinese. Examples must use gentle workflow humor and must not copy any competitor sentence.

- [ ] **Step 6: Verify all brands and pattern sections**

Run:

```bash
rg '^\| (Loom|ScreenPal|ScreenRec|Bandicam|Screencastify|VEED|Screen Studio|VideoScribe|Canva|Powtoon) \|' docs/seo/competitor-content-system-audit-2026-09-02.md
rg '^## (Shared patterns to implement|Layout system to implement|Voice system to implement)' docs/seo/competitor-content-system-audit-2026-09-02.md
```

Expected: 10 brand rows and three synthesis headings.

- [ ] **Step 7: Commit**

```bash
git add docs/seo/competitor-content-system-audit-2026-09-02.md
git commit -m "docs(seo): complete competitor content system audit"
```

### Task 3: Expand, Filter, and Cluster at Least 50 Keywords

**Files:**
- Create: `docs/seo/keyword-expansion-2026-09-02.csv`
- Create: `docs/seo/content-cluster-map-2026-09-02.csv`

**Interfaces:**
- Consumes: SEMrush US keyword metrics and Task 2 shared patterns.
- Produces: `keyword-expansion` columns `keyword,us_volume,kd_percent,cpc_usd,competition,intent,tier,seed,relevance,serp_overlap_group,verified_at`; `content-cluster-map` columns `keyword,target_slug,page_type,cluster,is_primary,wave,status,rationale`.

- [ ] **Step 1: Research device and audio seeds**

Collect qualified variants for screen recording with audio, Mac audio capture, Windows audio capture, browser tab capture, screen plus webcam, and microphone troubleshooting. Record zero rather than blank only when SEMrush explicitly reports zero.

- [ ] **Step 2: Research whiteboard and explainer seeds**

Collect qualified variants for whiteboard recording, whiteboard explainer, animated explainer, storyboard, script, teaching whiteboards, and animation software.

- [ ] **Step 3: Research editing and publishing seeds**

Collect qualified variants for captions, subtitles, video notes, handouts, trimming, Autozoom intent, aspect ratios, YouTube Shorts, Reels, and repurposing.

- [ ] **Step 4: Research workflow and competitor seeds**

Collect qualified variants for online courses, math tutorials, architecture walkthroughs, product demos, async updates, Loom alternatives, Screen Studio alternatives, Snagit alternatives, and other relevant competitor terms discovered in Task 2.

- [ ] **Step 5: Apply the three-tier filter**

Retain Quick wins at Volume 100–999/KD 0–29, Main terms at Volume ≥500/KD 0–39/Competition ≤0.60, and Strategic terms at Volume ≥1,000/KD 40–49. Retain KD >49 only as a secondary term on an already qualified cluster and explain that exception in `rationale`.

- [ ] **Step 6: Cluster by intent and SERP overlap**

Assign every retained keyword to exactly one `target_slug`. Mark exactly one primary keyword per new slug. Set `wave` to `upgrade`, `1`, `2`, or `3`; set `status` to `planned`.

- [ ] **Step 7: Verify minimum scale and uniqueness**

Run:

```bash
awk -F, 'NR>1{count++; if($1==""||$2==""||$3==""||$6==""||$7=="") bad++} END{print "keywords=" count, "incomplete=" bad; exit(count<50 || bad>0)}' docs/seo/keyword-expansion-2026-09-02.csv
awk -F, 'NR>1 && $5=="true"{primary[$2]++} END{for(slug in primary) if(primary[slug]!=1) bad=1; exit bad}' docs/seo/content-cluster-map-2026-09-02.csv
```

Expected: `keywords` is at least 50, `incomplete=0`, and every slug has exactly one primary keyword.

- [ ] **Step 8: Commit**

```bash
git add docs/seo/keyword-expansion-2026-09-02.csv docs/seo/content-cluster-map-2026-09-02.csv
git commit -m "docs(seo): expand and cluster qualified keywords"
```

### Task 4: Add Failing Content-System Quality Tests

**Files:**
- Create: `tests/e2e/seo-content-quality.spec.ts`
- Modify: `tests/e2e/seo-routes.spec.ts`

**Interfaces:**
- Consumes: `BLOG_ENTRIES`, the two Task 3 CSV files, and the five core slugs from the spec.
- Produces: executable quality gates used by Tasks 5–11.

- [ ] **Step 1: Add CSV scale and mapping tests**

Add this test shape using `readFileSync`, a small CSV-row parser that supports quoted commas, and repository-relative paths:

```ts
test('qualified keyword research maps at least 50 terms to one primary page', () => {
  const keywords = readCsv('docs/seo/keyword-expansion-2026-09-02.csv');
  const mappings = readCsv('docs/seo/content-cluster-map-2026-09-02.csv');
  expect(keywords.length).toBeGreaterThanOrEqual(50);
  expect(new Set(mappings.map((row) => row.keyword)).size).toBe(mappings.length);
  expect(new Set(mappings.filter((row) => row.is_primary === 'true').map((row) => row.target_slug)).size)
    .toBeGreaterThanOrEqual(15);
});
```

- [ ] **Step 2: Add five-core-article quality tests**

Count all English text from title, description, intro, body, structured blocks, and FAQs. Assert title 45–58 characters, lead 40–70 words, total 1,400–2,200 words, body 5–8 H2s, FAQs ≥3, sources ≥3, media ≥2, one decision aid, and one limitation/reality-check block. Also inspect every English body paragraph and fail when it exceeds 240 characters without a list, table, or deliberate code/example block.

- [ ] **Step 3: Add new-content and sitemap contracts**

Read planned slugs from the cluster map where `wave` is `1`, `2`, or `3`. Assert 15–20 distinct slugs, a matching `BLOG_ENTRIES` entry for each, and both `https://excalicast.cc/en/blog/<slug>` and `https://excalicast.cc/zh/blog/<slug>` in `sitemap()`.

- [ ] **Step 4: Run the tests and observe the intended failures**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts --reporter=line
```

Expected: FAIL because the five articles are short, structured visual blocks are absent, and planned new slugs do not exist. Record the failing assertion names in `docs/development-log.md`.

- [ ] **Step 5: Commit the red tests**

```bash
git add tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts docs/development-log.md
git commit -m "test(seo): enforce content system quality gates"
```

### Task 5: Split Blog Content into Cluster Modules Without Behavior Changes

**Files:**
- Create: `src/content/blog/legacy.ts`
- Create: `src/content/blog/platform.ts`
- Create: `src/content/blog/whiteboard.ts`
- Create: `src/content/blog/publishing.ts`
- Create: `src/content/blog/workflows.ts`
- Modify: `src/content/blog.ts`
- Test: `tests/e2e/seo-content-quality.spec.ts`

**Interfaces:**
- Consumes: existing raw entries from `src/content/blog.ts`.
- Produces: exported arrays `LEGACY_BLOG_ENTRIES`, `PLATFORM_BLOG_ENTRIES`, `WHITEBOARD_BLOG_ENTRIES`, `PUBLISHING_BLOG_ENTRIES`, `WORKFLOW_BLOG_ENTRIES`; aggregator `RAW_BLOG_ENTRIES` concatenates them before applying shared metadata.

- [ ] **Step 1: Add a regression assertion for the existing slug set**

Capture the current 10 slugs in an explicit sorted array and assert `BLOG_ENTRIES.map(({slug}) => slug).sort()` equals it before moving data.

- [ ] **Step 2: Run the slug assertion**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "preserves the existing blog slug set" --reporter=line
```

Expected: PASS before the refactor.

- [ ] **Step 3: Move raw objects into focused modules**

Each module exports `Omit<BlogEntry, 'updatedAt' | 'author' | 'sources' | 'heroMedia' | 'keyTakeaways'>[]`. Keep the exact object text unchanged during this step.

- [ ] **Step 4: Rebuild the aggregator**

Set:

```ts
const RAW_BLOG_ENTRIES = [
  ...LEGACY_BLOG_ENTRIES,
  ...PLATFORM_BLOG_ENTRIES,
  ...WHITEBOARD_BLOG_ENTRIES,
  ...PUBLISHING_BLOG_ENTRIES,
  ...WORKFLOW_BLOG_ENTRIES,
];
```

- [ ] **Step 5: Verify no route behavior changed**

Run:

```bash
npm run typecheck
npx playwright test tests/e2e/seo-routes.spec.ts -g "sitemap|blog|Semrush" --reporter=line
```

Expected: typecheck passes and all selected pre-existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/blog.ts src/content/blog tests/e2e/seo-content-quality.spec.ts
git commit -m "refactor(seo): split blog content by topic cluster"
```

### Task 6: Add Structured Blog Types and Reading Components

**Files:**
- Modify: `src/content/types.ts`
- Create: `src/components/content/BlogArticleBody.tsx`
- Create: `src/components/content/BlogMediaFigure.tsx`
- Create: `src/components/content/BlogDecisionTable.tsx`
- Create: `src/components/content/BlogCallout.tsx`
- Modify: `src/content/blog/whiteboard.ts`
- Modify: `src/app/[locale]/blog/[slug]/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/e2e/blog-reading-experience.spec.ts`

**Interfaces:**
- Consumes: existing `LocalizedText`, `BlogEntry`, and `pick()`.
- Produces:

```ts
export type BlogCluster = 'platform' | 'audio-camera' | 'whiteboard' | 'publishing' | 'workflow' | 'alternatives';
export type BlogMediaKind = 'product-screenshot' | 'diagram' | 'generated-illustration';
export interface BlogMedia { src: string; alt: LocalizedText; caption: LocalizedText; width: number; height: number; kind: BlogMediaKind }
export interface BlogDecisionTable { caption: LocalizedText; columns: LocalizedText[]; rows: LocalizedText[][] }
export interface BlogCallout { tone: 'answer' | 'tip' | 'warning' | 'reality-check'; title: LocalizedText; body: LocalizedText }
```

`BlogBlock` gains optional `id`, `media`, `table`, `callout`, and `checklist`; `BlogEntry` gains `cluster` and optional `readingMinutes`.

- [ ] **Step 1: Write rendered layout tests**

Use the whiteboard software comparison article as the fixture. Assert `.blog-craft-toc`, `.blog-craft-table-scroll`, `.blog-craft-callout`, and at least one `.blog-craft-figure` element exist; assert every TOC link points to a unique H2 id.

- [ ] **Step 2: Write a mobile overflow test**

At 390×844, assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, the TOC disclosure is visible, and the comparison table scroll container has `overflow-x: auto`.

- [ ] **Step 3: Run the layout tests and observe failure**

Run:

```bash
npx playwright test tests/e2e/blog-reading-experience.spec.ts --reporter=line
```

Expected: FAIL because the new structured classes and blocks do not exist.

- [ ] **Step 4: Add the structured types**

Add the interfaces above to `src/content/types.ts`. Keep new `BlogBlock` properties optional so legacy articles still compile. Make `BlogEntry.cluster` required and assign one of the six cluster values to every existing article in its raw cluster module during this step.

- [ ] **Step 5: Implement focused server components**

`BlogArticleBody` generates stable section ids as `<slugified-english-heading>-<one-based-index>`, renders a `<nav aria-label="On this page">`, and delegates media/table/callout blocks. `BlogMediaFigure` uses a native `<figure>` and `<figcaption>`. `BlogDecisionTable` wraps semantic `<table>` in a horizontal scroll container. `BlogCallout` maps tones to fixed bilingual labels and CSS modifiers.

- [ ] **Step 6: Integrate reading metadata and FAQ schema**

Compute reading minutes from localized visible text when `readingMinutes` is absent. Add `faqPageSchema(entry.faqs, locale)` to the JSON-LD array when FAQs exist. Render asset paths exactly as stored so `/blog/...` static images are not prefixed with the locale.

- [ ] **Step 7: Add responsive Craft styles**

Add `.blog-craft-layout`, `.blog-craft-toc`, `.blog-craft-body`, `.blog-craft-callout`, `.blog-craft-figure`, and `.blog-craft-table-scroll`. Use the existing Craft colors, borders, radii, and shadows. At ≤760px, collapse to one column and make the TOC a `<details>` disclosure.

- [ ] **Step 8: Run tests and typecheck**

Run:

```bash
npm run typecheck
npx playwright test tests/e2e/blog-reading-experience.spec.ts --reporter=line
```

Before running, add one permanent representative decision table, reality-check callout, and media figure to `whiteboard-animation-software-comparison` using the existing real Excalicast product asset. Task 8 will replace or expand that media with the final article-specific asset set. Expected: both commands pass.

- [ ] **Step 9: Commit**

```bash
git add src/content/types.ts src/content/blog src/components/content/BlogArticleBody.tsx src/components/content/BlogMediaFigure.tsx src/components/content/BlogDecisionTable.tsx src/components/content/BlogCallout.tsx 'src/app/[locale]/blog/[slug]/page.tsx' src/app/globals.css tests/e2e/blog-reading-experience.spec.ts
git commit -m "feat(seo): add authoritative blog reading components"
```

### Task 7: Build the Blog Cluster Index

**Files:**
- Modify: `src/app/[locale]/blog/page.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/e2e/blog-reading-experience.spec.ts`

**Interfaces:**
- Consumes: `BlogEntry.cluster` and `BLOG_ENTRIES`.
- Produces: bilingual cluster navigation with stable anchors `platform`, `audio-camera`, `whiteboard`, `publishing`, `workflow`, and `alternatives`.

- [ ] **Step 1: Add a failing cluster-index test**

Assert `/en/blog` shows six named cluster links, each blog card appears once, and each cluster section has a visible descriptive lead.

- [ ] **Step 2: Run the test and observe failure**

Run:

```bash
npx playwright test tests/e2e/blog-reading-experience.spec.ts -g "blog index groups articles" --reporter=line
```

Expected: FAIL because the index is still a single chronological list.

- [ ] **Step 3: Implement the grouped index**

Define a bilingual cluster-label map in the page module, group entries by cluster, retain date ordering inside each cluster, and add a compact `Explore by topic` navigation above the sections.

- [ ] **Step 4: Add responsive index styles**

Use a two-column card grid above 900px and one column below. Keep titles readable and do not truncate descriptions needed to understand search intent.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx playwright test tests/e2e/blog-reading-experience.spec.ts -g "blog index groups articles" --reporter=line
```

Expected: PASS.

```bash
git add 'src/app/[locale]/blog/page.tsx' src/app/globals.css tests/e2e/blog-reading-experience.spec.ts
git commit -m "feat(seo): organize blog into topic clusters"
```

### Task 8: Produce and Register Original Visual Assets

**Files:**
- Create: `docs/seo/visual-asset-manifest-2026-09-02.csv`
- Create: `public/blog/<target-slug>/*.{webp,png}`
- Modify: `tests/e2e/seo-content-quality.spec.ts`

**Interfaces:**
- Consumes: Task 3 `content-cluster-map`, current project UI, and the image-source priority in the spec.
- Produces: manifest columns `slug,asset_path,kind,width,height,en_alt,zh_alt,en_caption,zh_caption,prompt_or_capture_route,verified_at` and at least two registered assets for every upgraded/new article.

- [ ] **Step 1: Add failing asset-manifest tests**

For each upgraded/new slug, assert at least two rows, an existing file under `public/blog/<slug>/`, positive dimensions, non-empty bilingual alt/caption fields, and `kind` in `product-screenshot|diagram|generated-illustration`.

- [ ] **Step 2: Run the test and observe failure**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "visual asset manifest" --reporter=line
```

Expected: FAIL because the asset manifest is absent.

- [ ] **Step 3: Capture real product evidence**

Run the local app with seeded/demo-safe content. Capture the recording setup, whiteboard recording, editor timeline, Autozoom, captions, handout, and multi-ratio export views needed by the content map. Crop out browser chrome and verify no account or recording identifiers are visible.

- [ ] **Step 4: Create deterministic diagrams**

Use SVG or HTML/CSS capture for operation-stream versus pixel capture, capture-to-publish workflow, aspect-ratio decision tree, and live-whiteboard versus template-animation decision flow. Keep essential labels in HTML/captions rather than tiny raster text.

- [ ] **Step 5: Generate editorial illustrations where the manifest requires them**

Use built-in ImageGen once per distinct asset. Prompts must state `illustration`, preserve negative space for article layout, forbid logos/UI/watermarks, and use the site's warm paper/ink/blue-highlight visual language. Copy selected results into the matching `public/blog/<slug>/` directory and record the final prompt in the manifest.

- [ ] **Step 6: Optimize and verify assets**

Convert photographic/illustrative assets to WebP when transparency is unnecessary. Keep hero assets near 1200×630 and inline assets at a width appropriate to their rendered container.

- [ ] **Step 7: Run the manifest test and commit**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "visual asset manifest" --reporter=line
```

Expected: PASS.

```bash
git add docs/seo/visual-asset-manifest-2026-09-02.csv public/blog tests/e2e/seo-content-quality.spec.ts
git commit -m "feat(seo): add original blog visual evidence"
```

### Task 9: Upgrade the Five Core Articles to the Top 3 Standard

**Files:**
- Modify: `src/content/blog/platform.ts`
- Modify: `src/content/blog/whiteboard.ts`
- Modify: `src/content/blog.ts`
- Modify: `tests/e2e/seo-content-quality.spec.ts`

**Interfaces:**
- Consumes: Task 2 format/voice rules, Task 3 keyword clusters, Task 6 structured blocks, and Task 8 assets.
- Produces: five fully bilingual publish-ready entries for the exact slugs in the spec.

- [ ] **Step 1: Expand the Windows article**

Use 6–8 sections covering quick choice, Snipping Tool, Game Bar, browser workflow, audio/privacy checklist, troubleshooting, and decision guidance. Include a product screenshot, capture-method diagram, decision table, reality check, and official Microsoft sources.

- [ ] **Step 2: Expand the screencasting article**

Cover definition, use cases, pixel versus structured capture, one-outcome scripting, recording habits, editing/captions, publishing, and tool choice. Add one concise mishap joke, a workflow diagram, a checklist, and TechSmith/Panopto plus product sources.

- [ ] **Step 3: Expand the Mac article**

Cover Screenshot toolbar, QuickTime, OBS, Loom, Screen Studio, Excalicast, permissions/system audio, and scenario choice. Incorporate the Mac-audio keyword cluster without duplicating the future dedicated troubleshooting article's intent.

- [ ] **Step 4: Expand the whiteboard-animation explainer article**

Define whiteboard animation, animated explainers, and hand-drawn animation; compare live, template, and frame-by-frame production; cover scripts/storyboards, use cases, limitations, and a five-step workflow.

- [ ] **Step 5: Expand the software-comparison article**

Add a real decision table covering production model, drawing control, audio/camera, captions, aspect ratios, collaboration, asset licensing considerations, watermark checks, and best-fit scenario for Excalicast, VideoScribe, Canva, Powtoon, Animaker, Renderforest, and Explain Everything.

- [ ] **Step 6: Run the five-article quality tests**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "five core articles" --reporter=line
```

Expected: PASS with every article inside all content thresholds.

- [ ] **Step 7: Render both locales**

Run:

```bash
npx playwright test tests/e2e/blog-reading-experience.spec.ts -g "core article" --reporter=line
```

Expected: PASS for English and Chinese title, TOC, figures, table/checklist, FAQ, references, and canonical metadata.

- [ ] **Step 8: Commit**

```bash
git add src/content/blog/platform.ts src/content/blog/whiteboard.ts src/content/blog.ts tests/e2e/seo-content-quality.spec.ts tests/e2e/blog-reading-experience.spec.ts
git commit -m "feat(seo): upgrade core guides to top-three depth"
```

### Task 10: Publish Wave 1 Device and Audio Articles

**Files:**
- Modify: `src/content/blog/platform.ts`
- Modify: `src/content/blog.ts`
- Modify: `tests/e2e/seo-content-quality.spec.ts`
- Modify: `tests/e2e/seo-routes.spec.ts`

**Interfaces:**
- Consumes: Task 3 rows where `wave=1`, Task 6 components, and Task 8 assets.
- Produces: every Wave 1 entry in `BLOG_ENTRIES`, bilingual sitemap routes, and cross-links to platform/audio hubs and related comparisons.

- [ ] **Step 1: Add failing Wave 1 entry assertions**

Read all `wave=1` slugs from the cluster map. Assert each entry exists, maps every assigned keyword into searchable copy, and meets the global content threshold.

- [ ] **Step 2: Run Wave 1 tests and observe failure**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "Wave 1" --reporter=line
```

Expected: FAIL with the first absent Wave 1 slug.

- [ ] **Step 3: Author the Wave 1 entries**

For each Wave 1 slug, follow its primary intent and decision framework from the cluster map. Use official OS/browser sources, show authentic Excalicast boundaries, and include two to four natural humor beats only where they help pacing.

- [ ] **Step 4: Add bidirectional links**

Link each article to its cluster hub, at least two sibling articles, one relevant use-case or comparison page, and the most appropriate product CTA.

- [ ] **Step 5: Run Wave 1 and sitemap tests**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "Wave 1" --reporter=line
npx playwright test tests/e2e/seo-routes.spec.ts -g "sitemap|cannibalization" --reporter=line
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/blog/platform.ts src/content/blog.ts tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts
git commit -m "feat(seo): publish device and audio content wave"
```

### Task 11: Publish Waves 2 and 3 Across the Remaining Clusters

**Files:**
- Modify: `src/content/blog/whiteboard.ts`
- Modify: `src/content/blog/publishing.ts`
- Modify: `src/content/blog/workflows.ts`
- Modify: `src/content/blog.ts`
- Modify: `tests/e2e/seo-content-quality.spec.ts`
- Modify: `tests/e2e/seo-routes.spec.ts`

**Interfaces:**
- Consumes: Task 3 rows where `wave=2` or `wave=3` plus all structured content/media interfaces.
- Produces: the remaining planned blog entries so total net-new slugs is 15–20 and total blog count is approximately 25–30.

- [ ] **Step 1: Add failing Wave 2 and Wave 3 assertions**

Assert every planned slug exists, cluster counts match the cluster map, every assigned keyword appears on only its selected primary page, and every new entry has at least three internal links.

- [ ] **Step 2: Run the tests and observe failure**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "Wave 2|Wave 3" --reporter=line
```

Expected: FAIL for absent Wave 2/3 entries.

- [ ] **Step 3: Author Wave 2 whiteboard and publishing articles**

Implement all Wave 2 rows in `whiteboard.ts` and `publishing.ts`, preserving their exact primary/secondary mapping. Use live-versus-template decision aids, product workflow screenshots, caption/export evidence, and explicit limitations.

- [ ] **Step 4: Run Wave 2 tests**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "Wave 2" --reporter=line
```

Expected: PASS.

- [ ] **Step 5: Commit Wave 2**

```bash
git add src/content/blog/whiteboard.ts src/content/blog/publishing.ts src/content/blog.ts tests/e2e/seo-content-quality.spec.ts
git commit -m "feat(seo): publish whiteboard and editing content wave"
```

- [ ] **Step 6: Author Wave 3 workflow and alternatives articles**

Implement all Wave 3 rows in `workflows.ts` and the relevant cluster module. For alternatives articles, include 4–7 real options, honest best/not-best guidance, public sources, and links to single-competitor comparison pages.

- [ ] **Step 7: Run Wave 3 and route tests**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "Wave 3" --reporter=line
npx playwright test tests/e2e/seo-routes.spec.ts -g "sitemap|cannibalization" --reporter=line
```

Expected: PASS.

- [ ] **Step 8: Commit Wave 3**

```bash
git add src/content/blog/workflows.ts src/content/blog src/content/blog.ts tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts
git commit -m "feat(seo): publish workflow and alternatives content wave"
```

### Task 12: Generate the Complete Indexing URL Manifest and Verify the Release

**Files:**
- Create: `docs/seo/indexing-url-manifest-2026-09-02.csv`
- Modify: `docs/seo/content-cluster-map-2026-09-02.csv`
- Modify: `docs/development-log.md`
- Modify: `tests/e2e/seo-content-quality.spec.ts`

**Interfaces:**
- Consumes: final `BLOG_ENTRIES`, sitemap output, and Task 3 keyword mapping.
- Produces: one row per locale per new/updated slug with columns `page_type,slug,locale,canonical_url,primary_keyword,secondary_keywords,priority,published_at,last_verified_at,submission_status,notes`.

- [ ] **Step 1: Add a failing manifest parity test**

Assert each upgraded/new slug has exactly two manifest rows, locales are `en` and `zh`, canonical URLs start with `https://excalicast.cc/<locale>/blog/`, and each URL exists in `sitemap()`.

- [ ] **Step 2: Run the test and observe failure**

Run:

```bash
npx playwright test tests/e2e/seo-content-quality.spec.ts -g "indexing URL manifest" --reporter=line
```

Expected: FAIL because the final manifest has not been generated.

- [ ] **Step 3: Generate the full manifest**

Create two rows for every upgraded/new slug. Set `submission_status` to `not_submitted`. Set priority order to `P0` for qualified Quick wins and high-relevance Main terms, `P1` for remaining Main/Strategic pages, and `P2` for supporting pages.

- [ ] **Step 4: Mark research mappings as published**

Change `status` in `content-cluster-map` from `planned` to `published` only when both localized routes build successfully.

- [ ] **Step 5: Run static, rendered, and build verification**

Run:

```bash
npm run typecheck
npx playwright test tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts tests/e2e/seo-pages.spec.ts tests/e2e/blog-reading-experience.spec.ts --reporter=line
npm run build
git diff --check
```

Expected: all commands exit 0; Playwright reports zero failures; the build statically generates both locales for every new slug.

- [ ] **Step 6: Perform visual verification**

Open one English and one Chinese page from each cluster at desktop and mobile widths. Check hero hierarchy, reading metadata, TOC, short paragraphs, visual captions, table scrolling, callouts, FAQ, references, related links, and CTA. Record the checked URLs in `docs/development-log.md`.

- [ ] **Step 7: Update the development log**

Record keyword count, competitor count, upgraded article count, net-new article count, asset count by kind, generated static page count, Playwright result, build result, and the URL manifest path.

- [ ] **Step 8: Commit the release artifacts**

```bash
git add docs/seo/indexing-url-manifest-2026-09-02.csv docs/seo/content-cluster-map-2026-09-02.csv docs/development-log.md tests/e2e/seo-content-quality.spec.ts
git commit -m "docs(seo): publish indexing manifest and verification"
```

- [ ] **Step 9: Present the complete submission list**

In the user-facing delivery, print every full English and Chinese URL from the manifest grouped by P0, P1, and P2. Include the sitemap URL `https://excalicast.cc/sitemap.xml`, but do not replace the explicit page list with the sitemap link.
