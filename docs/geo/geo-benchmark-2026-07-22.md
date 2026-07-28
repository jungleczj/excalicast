# Excalicast GEO Benchmark — 2026-07-22

This benchmark is based on:

- Google Search Console CSV exports supplied by the user on 2026-07-22.
- The current Excalicast codebase in `/Users/chenzhijiang/.codex/worktrees/53c2/pro`.
- Current crawlable site architecture: landing page, compare pages, use-case pages, blog pages, sitemap, robots, JSON-LD, and `/llms.txt`.

## Important Measurement Boundary

This file does **not** claim live ChatGPT / Gemini / Google AI Overview / Perplexity answer results.

Reason: the current environment has no authenticated sessions or approved APIs for those four answer surfaces, and Google AI Overview availability varies by query, account, locale, and region. To avoid fabricating results, this benchmark separates:

1. **Observed Search Console baseline** — real impressions/clicks from Google Search.
2. **Owned-answer coverage** — whether the current site has crawlable, answerable pages for the question.
3. **Four-platform scorecard** — the exact prompts and scoring grid to run in ChatGPT, Gemini, Google AI Overview / AI Mode, and Perplexity.

## Baseline Search Console Snapshot

Keyword export:

- Rows: `26`
- Impressions: `247`
- Clicks: `22`
- CTR: `8.91%`

Page export:

- Rows: `8`
- Impressions: `266`
- Clicks: `22`
- CTR: `8.27%`

Traffic concentration:

- `/zh` produced `248 / 266` page impressions (`93.2%`) and `22 / 22` clicks (`100%`).
- Content pages are indexed or discoverable but not yet converting clicks:
  - `/zh/use-cases/record-whiteboard-lecture`: `4` impressions, `0` clicks, avg position `7.25`
  - `/zh/use-cases`: `4` impressions, `0` clicks, avg position `9.00`
  - `/zh/compare/excalicast-vs-excalidraw`: `2` impressions, `0` clicks, avg position `6.50`
  - `/zh/blog/one-recording-every-aspect-ratio`: `1` impression, `0` clicks, avg position `6.00`
  - `/zh/blog/record-whiteboard-without-screen-recording`: `1` impression, `0` clicks, avg position `6.00`

Brand ambiguity:

- `excalicord` and `excalicord 白板` account for `198 / 247` keyword impressions (`80.2%`).
- This is currently the dominant discoverability pattern and should be treated as a P0 GEO/SEO entity issue.

## Scoring Definitions

### Four-platform answer score

Use this for ChatGPT, Gemini, Google AI Overview / AI Mode, and Perplexity:

- `1.0`: Excalicast appears as a recommended option with correct name and link/citation.
- `0.5`: Excalicast appears but is not recommended, lacks citation, or appears below several less relevant tools.
- `0`: Excalicast is absent.
- `-1 flag`: wrong-brand confusion, e.g. `ExcaliCast`, `Excalicord`, `ExcaliRec`, or a non-Excalicast domain is treated as this product.

### Owned-answer coverage

This is an internal readiness score, not an answer-engine ranking:

- `Strong`: the current site has a direct, crawlable page that can answer the prompt.
- `Medium`: the current site has relevant content, but the page is not direct enough or lacks a concise answer block.
- `Weak`: content is scattered, private, or not clearly crawlable.

### Search Console prompt evidence

This indicates whether the supplied CSV contains a near-matching query/page impression for the prompt theme.

## 20 Prompt Benchmark

| ID | Prompt | Locale | Intent cluster | Current best owned page | Owned-answer coverage | GSC near-query evidence |
|---:|---|---|---|---|---|---|
| 1 | What is the best tool to record an Excalidraw whiteboard as a video with voice? | EN | Excalidraw recording | `/en/compare/excalicast-vs-excalidraw`, `/en/use-cases/record-whiteboard-lecture` | Strong | Yes — `excalidraw可以录视频`, `excalidraw怎么录制` |
| 2 | How can I record an Excalidraw canvas without using screen recording? | EN | Excalidraw + no screen recording | `/en/blog/record-whiteboard-without-screen-recording`, `/en/compare/excalicast-vs-screen-recording` | Strong | Yes — screen/whiteboard related queries |
| 3 | Which browser-based whiteboard recorder can export MP4 with webcam and microphone? | EN | Whiteboard recorder / MP4 / webcam | `/en`, `/en/use-cases/record-whiteboard-lecture` | Medium | Yes — `白板录视频`, `白板录视频工具` |
| 4 | What is a good Loom alternative for whiteboard explainer videos? | EN | Loom alternative | `/en/compare/excalicast-vs-loom`, `/en/blog/loom-alternatives-for-whiteboard` | Strong | No |
| 5 | How do I turn one whiteboard recording into 16:9 and 9:16 videos? | EN | Multi-ratio export | `/en/blog/one-recording-every-aspect-ratio`, `/en/use-cases/whiteboard-video-for-youtube-shorts` | Strong | Yes — `16：9导出到抖音` + page impression |
| 6 | Which whiteboard recorder is best for online teachers who need subtitles? | EN | Teaching + subtitles | `/en/use-cases/record-whiteboard-lecture`, `/en/use-cases/add-subtitles-to-whiteboard-video` | Medium | No |
| 7 | What tool should a software architect use to record an async system-design walkthrough? | EN | Architecture walkthrough | `/en/use-cases/async-architecture-walkthrough`, `/en/use-cases/system-design-explainer` | Strong | No |
| 8 | How can I record a math tutorial on a whiteboard and publish it to YouTube? | EN | Math tutorial | `/en/use-cases/record-math-tutorial` | Strong | Yes — `whiteboard math video recording tips` |
| 9 | What local-first whiteboard recording tool keeps recordings on my device? | EN | Local-first privacy | `/en`, `/en/privacy`, `/en/blog/record-whiteboard-without-screen-recording` | Medium | No |
| 10 | Which tools can record a whiteboard and generate captions, outlines, and handouts? | EN | Captions + outlines + handouts | `/en/pricing`, `/en` | Weak | No |
| 11 | Excalidraw 怎么录制成视频并带上语音？ | ZH | Excalidraw 录制视频 | `/zh/compare/excalicast-vs-excalidraw`, `/zh/use-cases/record-whiteboard-lecture` | Strong | Yes — `excalidraw可以录视频`, `excalidraw怎么录制` |
| 12 | 有没有在线白板录视频工具，能直接导出 MP4？ | ZH | 白板录视频工具 | `/zh`, `/zh/use-cases/record-whiteboard-lecture` | Medium | Yes — `白板录视频`, `白板录视频工具`, `录屏白板` |
| 13 | 白板讲课录制后怎么自动生成字幕？ | ZH | 自动字幕 | `/zh/use-cases/add-subtitles-to-whiteboard-video` | Medium | No |
| 14 | 有什么适合录制数学讲题的白板录制工具？ | ZH | 数学讲题 | `/zh/use-cases/record-math-tutorial` | Strong | Yes — `whiteboard math video recording tips` |
| 15 | 如何把一次白板录制同时导出横屏和竖屏？ | ZH | 多比例导出 | `/zh/blog/one-recording-every-aspect-ratio` | Strong | Yes — aspect-ratio query/page impression |
| 16 | Loom 有没有更适合白板讲解的替代工具？ | ZH | Loom 替代 | `/zh/compare/excalicast-vs-loom`, `/zh/blog/loom-alternatives-for-whiteboard` | Strong | No |
| 17 | 录制架构图讲解，怎么避免窗口遮挡被录进去？ | ZH | 架构讲解 + 抗遮挡 | `/zh/compare/excalicast-vs-screen-recording`, `/zh/use-cases/async-architecture-walkthrough` | Strong | Yes — `屏幕录制 白板` and no-screen-recording page impression |
| 18 | 哪个工具可以在浏览器里录白板、剪辑、加字幕、再发布？ | ZH | 一站式工作台 | `/zh` | Medium | No |
| 19 | 白板录制内容怎么归档成可以搜索的素材？ | ZH | 归档 / 可搜索资产 | `/zh` | Weak | No |
| 20 | Excalidraw 白板讲解如何录制、剪辑并分发到多个平台？ | ZH | Excalidraw + workflow + distribution | `/zh/compare/excalicast-vs-excalidraw`, `/zh/blog/one-recording-every-aspect-ratio` | Medium | Yes — Excalidraw + aspect-ratio themes |

## Current GEO Readiness Metrics

### Owned-answer coverage

- Strong: `11 / 20`
- Medium: `7 / 20`
- Weak: `2 / 20`
- Weighted readiness score: `(11 * 1 + 7 * 0.5 + 2 * 0) / 20 = 72.5%`

Interpretation: Excalicast already has enough crawlable content to answer many high-intent prompts, but several pages need direct-answer blocks and tighter landing paths for AI extraction.

### Search Console prompt-theme evidence

- Prompts with near-query evidence in the supplied CSV: `11 / 20`
- Prompts without query evidence yet: `9 / 20`
- Organic proxy visibility: `55%`

Interpretation: Google has begun seeing Excalicast for Excalidraw recording, whiteboard recording, multi-ratio export, math/tutorial, and no-screen-recording themes. It has not yet shown meaningful evidence for Loom alternatives, subtitles, handouts/outlines, local-first/privacy, archive/searchable-assets, or architecture walkthrough queries.

### True four-platform answer rate

Not measured in this environment.

Required next measurement:

- `20` prompts × `4` answer surfaces = `80` checks.
- Baseline output should be stored in `docs/geo/benchmark-results-template.csv` or a dated copy such as `docs/geo/benchmark-results-2026-07-22.csv`.

## Estimated Risk by Prompt Cluster

| Cluster | Risk | Reason | Fix priority |
|---|---|---|---|
| Brand/entity | High | Search visibility is dominated by `excalicord`; product name/domain ambiguity can poison AI answers. | P0 |
| Excalidraw recording | Medium | Existing pages exist and have impressions, but snippets need direct answer and stronger internal links. | P1 |
| Whiteboard recorder | Medium | Queries exist; homepage ranks, but dedicated Chinese category page is thin. | P1 |
| Loom alternative | High | Existing pages exist, but no CSV evidence yet; competitors dominate broad SERPs. | P1 |
| Subtitles | High | Feature exists but query evidence is absent; needs dedicated answer-first page. | P1 |
| Architecture walkthrough | Medium | Owned content exists but likely not enough external/entity reinforcement. | P2 |
| Local-first/privacy | Medium | Strong differentiator, but content is split between landing, privacy, and blog. | P2 |
| Archive/searchable assets | High | Core new positioning is not represented by a dedicated SEO page. | P1 |
| Captions/outlines/handouts | High | This is a Max feature cluster but currently lacks an answerable content path. | P1 |

## Next GEO Optimization Recommendations

### P0 — Fix entity and crawl hygiene

1. Fix localized robots rules:
   - Disallow `/zh/app`, `/en/app`, `/zh/library`, `/en/library`, `/zh/s/`, `/en/s/` if these are not intended search pages.
2. Fix `Organization.logo` to point at the real top-level logo asset.
3. Audit `excalicord.com`:
   - If owned, 301 redirect to `https://excalicast.cc`.
   - If not owned, add neutral disambiguation in `llms.txt` and a visible FAQ.
4. Reduce title duplication on legal pages.

### P1 — Create answer-first pages for missing high-intent clusters

1. `Excalidraw 怎么录制成视频`
2. `白板录视频工具`
3. `白板录制自动字幕`
4. `白板录制内容归档成可搜索资产`
5. `record a whiteboard and generate captions, outlines, and handouts`
6. `Loom alternative for whiteboard explainer videos`

Each page should begin with a concise direct answer:

- English: `The short answer: ...`
- Chinese: `简短答案：...`

### P1 — Turn homepage ranking into content-page ranking

Current issue: `/zh` owns almost all clicks.

Action:

- Add prominent internal links from homepage sections and FAQ to the exact use-case / compare / blog pages.
- Add related links from high-impression pages back into the content clusters.
- Give each content page a stronger title and meta description aligned with the query.

### P2 — Make AI extraction easier

On strategic pages, add:

- Best for / Not best for
- Fact sheet
- Feature table
- Pricing boundary
- Privacy boundary
- Competitor comparison if relevant
- FAQ with short, non-marketing answers

### P2 — Add external corroboration

AI systems cite sources they can corroborate. Prioritize:

- Excalidraw community/forum mention if allowed.
- GitHub README or public changelog with factual feature list.
- Product Hunt / directories / alternative-to pages.
- Creator demos using the exact query language.
- Documentation pages with stable URLs.

## Four-Platform Manual Benchmark Instructions

Run each prompt in:

1. ChatGPT with search enabled
2. Gemini
3. Google AI Overview / AI Mode
4. Perplexity

For each result:

1. Copy the answer excerpt that includes or excludes Excalicast.
2. Record if Excalicast appears.
3. Record rank position if the answer is a list.
4. Record cited URL.
5. Record competitors.
6. Flag wrong-brand confusion.

Store in:

- `docs/geo/benchmark-results-template.csv`

## Success Targets

28-day targets:

- Non-brand impressions +50%.
- Content pages reach at least 25% of page impressions.
- `/zh/app` disappears from indexable reports if intentionally noindexed/disallowed.
- True answer-engine benchmark: Excalicast appears in at least `8 / 20` prompts on at least one answer surface.

90-day targets:

- Weighted four-platform visibility reaches at least `40%` across `80` checks.
- Excalicast appears top-3 for at least `6` high-intent prompts.
- Wrong-brand confusion rate below `10%`.
