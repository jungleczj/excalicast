# Excalicast SEO / GEO Action Plan — 2026-07-27

## Source data

This plan uses the two Search Console exports supplied by the user:

- `/Users/chenzhijiang/Downloads/excalicast.cc_KeywordReport_7_22_2026.csv`
- `/Users/chenzhijiang/Downloads/excalicast.cc_PageTrafficReport_7_22_2026.csv`

Related benchmark/proxy files:

- `docs/geo/benchmark-results-template.csv`
- `docs/geo/public-search-proxy-2026-07-27.md`

It also reviews the current project structure:

- `src/content/use-cases.ts`
- `src/content/blog.ts`
- `src/content/compare.ts`
- `src/app/sitemap.ts`
- `src/app/robots.ts`
- `src/app/llms.txt/route.ts`

## Baseline from the CSV exports

### Keyword baseline

- Keyword rows: `26`
- Total impressions: `247`
- Total clicks: `22`
- Blended CTR: `8.91%`

The current visible demand is dominated by brand-confused queries:

| Query cluster | Impressions | Clicks | Notes |
|---|---:|---:|---|
| `excalicord` / `excalicord 白板` | `198` | `14` | `80.2%` of keyword impressions |
| Excalicord long-tail variants | `22+` | `2+` | Includes `.com`, 官网, github, download |
| Excalidraw recording | `6` | `2` | Early high-intent signal |
| Whiteboard recording | `13` | `5` | Small but valuable non-brand signal |
| Multi-ratio / Douyin export | `1` | `0` | Good product-fit topic, no scale yet |

### Page baseline

- Page rows: `8`
- Total impressions: `266`
- Total clicks: `22`
- Blended CTR: `8.27%`

Traffic concentration is the main structural problem:

| Page | Impressions | Clicks | Avg position |
|---|---:|---:|---:|
| `/zh` | `248` | `22` | `2.93` |
| `/zh/use-cases/record-whiteboard-lecture` | `4` | `0` | `7.25` |
| `/zh/app` | `4` | `0` | `4.25` |
| `/zh/use-cases` | `4` | `0` | `9.00` |
| `/zh/compare/excalicast-vs-excalidraw` | `2` | `0` | `6.50` |
| `/en/use-cases/record-math-tutorial` | `2` | `0` | `1.00` |

Interpretation:

- Google already understands the homepage for branded / near-branded demand.
- Content pages are discoverable but not yet earning clicks.
- `/zh/app` should not be an indexed landing page; private app routes need localized robots controls.

## Current project strengths

- Localized content architecture already exists.
- Sitemap enumerates marketing and content routes.
- `/llms.txt` exists and is useful for answer-engine extraction.
- Compare, blog, and use-case structures already cover some high-intent prompts.
- Product has a distinctive position: whiteboard / Excalidraw-style recording, local-first, multi-ratio export, subtitles, handouts, share links.

## Public-search spot check — 2026-07-27

This is not a ChatGPT/Gemini/Google AI Overview/Perplexity benchmark. It is only a public-web entity signal check.

Observed signals:

- `https://excalicast.cc/en` is crawlable and exposes the new one-workspace positioning.
- `https://excalicast.cc/en/compare` is crawlable and exposes comparison routes.
- Legal pages still show title duplication in public results, e.g. `Refund Policy · Excalicast · Excalicast`.
- SaaSHub has an external Excalicast.cc listing, but with sparse feature/review data. This is useful as an entity foothold, but needs stronger corroboration.

Sources to re-check manually:

- `https://excalicast.cc/en`
- `https://excalicast.cc/en/compare`
- `https://excalicast.cc/en/refund`
- `https://www.saashub.com/compare-excalicast-cc-vs-explain-everything`

## Current gaps

1. **Entity ambiguity**
   - Search Console shows users are finding the product through `excalicord`.
   - AI systems may confuse Excalicast with similarly named products/domains.

2. **Crawl controls**
   - `robots.ts` disallows `/app`, `/library`, `/s/`, but the actual indexed paths are localized, e.g. `/zh/app`.
   - Add `/zh/app`, `/en/app`, `/zh/library`, `/en/library`, `/zh/s/`, `/en/s/`.

3. **Homepage over-concentration**
   - `/zh` owns almost all clicks.
   - The use-case / compare / blog pages need stronger internal links, direct answer blocks, and better snippets.

4. **GEO extraction**
   - Existing content is useful, but many pages read like articles rather than answer cards.
   - Answer engines need concise fact blocks: “Best for”, “Not best for”, “How it works”, “Pricing boundary”, “Privacy boundary”, “Compared with Loom / screen recording / Excalidraw”.

5. **One-stop positioning not fully represented**
   - The new product story is no longer just “whiteboard recording”.
   - SEO/GEO pages should describe the full workflow: record → edit → subtitle → export → distribute → archive/search.

## Priority plan

### P0 — Entity and crawl hygiene

- Fix localized robots disallow rules.
- Ensure Organization / SoftwareApplication schema uses the current logo URL.
- Add a neutral disambiguation section to `/llms.txt`:
  - Canonical name: `Excalicast`
  - Canonical domain: `https://excalicast.cc`
  - Not `Excalicord`, not `ExcaliRec`, not other similarly named tools.
- If `excalicord.com` is owned, redirect it to `excalicast.cc`.
- If it is not owned, avoid claiming ownership; only clarify canonical domain.

### P1 — Convert homepage ranking into cluster ranking

Add / strengthen these query-led pages:

1. `Excalidraw 怎么录制成视频`
2. `白板录视频工具`
3. `白板录制自动字幕`
4. `一次录制如何导出横屏和竖屏`
5. `白板讲解如何剪辑、加字幕并分发`
6. `Loom alternative for whiteboard explainers`
7. `Record an Excalidraw canvas without screen recording`
8. `Record a whiteboard and generate captions, outlines, and handouts`
9. `Local-first whiteboard recorder`
10. `Searchable recording library for lessons and walkthroughs`

Each page should start with a direct answer block:

```text
简短答案：...
适合：...
不适合：...
你会得到：视频、字幕、大纲、讲义、可重导出的录制资产。
```

### P1 — Internal linking map

Homepage sections should link to exact intent pages:

| Homepage story | Target page |
|---|---|
| Record once | `/use-cases/record-whiteboard-lecture` |
| Multi-ratio export | `/blog/one-recording-every-aspect-ratio` |
| Excalidraw recording | `/compare/excalicast-vs-excalidraw` |
| Not screen recording | `/compare/excalicast-vs-screen-recording` |
| Loom alternative | `/compare/excalicast-vs-loom` |
| Subtitles | `/use-cases/add-subtitles-to-whiteboard-video` |
| Archive/searchable asset | new use-case page |

### P2 — GEO-friendly page components

Add reusable page sections:

- `DirectAnswer`
- `FactSheet`
- `BestFor`
- `NotBestFor`
- `WorkflowSteps`
- `FeatureBoundary`
- `CompetitorComparison`
- `FAQCompact`

These should be visible HTML, not only JSON-LD.

### P2 — External corroboration

Answer engines prefer claims corroborated across the web. Prioritize:

- public changelog / docs page;
- GitHub README or public repo/docs page if appropriate;
- Product Hunt or software directory listings;
- one or two demo pages with embedded videos;
- comparison pages that fairly describe competitors.

## 20-question GEO benchmark

Run each prompt in four answer surfaces:

1. ChatGPT with search/browsing enabled
2. Gemini
3. Google AI Overview / AI Mode where available
4. Perplexity

Scoring:

- `1.0`: Excalicast is recommended with correct name and cited URL.
- `0.5`: Excalicast is mentioned but not recommended, not cited, or buried.
- `0`: Excalicast absent.
- `-1 flag`: wrong-brand confusion.

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

## What can be automated

- Generate the 80-row benchmark CSV scaffold.
- Check if Excalicast appears in public search snippets for the 20 prompts.
- Crawl Excalicast pages and verify:
  - direct answer block exists;
  - canonical/hreflang exists;
  - JSON-LD exists;
  - target internal links exist;
  - private routes are excluded from robots/sitemap.

## What requires manual or external-tool execution

- ChatGPT, Gemini, Google AI Overview, and Perplexity answer-rate measurement.
- Google AI Overview availability, because it varies by account, geography, and query.
- Citation extraction from logged-in AI answer products.

Do not fabricate these results. Store real runs in:

- `docs/geo/benchmark-results-template.csv`
- or dated copies such as `docs/geo/benchmark-results-2026-07-27.csv`

After filling the CSV, calculate answer visibility with:

```bash
npm run geo:score -- docs/geo/benchmark-results-2026-07-27.csv
```

The scoring script reports:

- total measured checks;
- Excalicast inclusion rate;
- weighted visibility score;
- Top-3 rate;
- wrong-brand rate;
- platform-level and locale-level breakdowns.

## Success targets

30-day target:

- Fix brand/entity ambiguity.
- Remove private `/zh/app` from search exposure.
- Add direct-answer blocks to the top 6 intent pages.
- Get non-homepage pages to at least `20%` of impressions.

90-day target:

- At least `40%` weighted visibility across the 80 answer checks.
- At least `6` prompts where Excalicast is top-3 in an answer list.
- Zero wrong-brand recommendations in the benchmark.
- Non-brand queries become the majority of impressions.
