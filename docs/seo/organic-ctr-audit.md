# Excalicast Organic CTR Audit

Date: 2026-08-05

Scope: Search Console CSV exports dated 2026-07-22, current `codex/recovered-53c2` worktree SEO implementation, Chinese/English public metadata, canonical/hreflang, structured data, SERP intent fit, brand confusion around Excalicord/ExcaliRec, comparison pages, and conversion paths.

No product code was edited. This is a research and experiment plan only.

## Executive Summary

The CTR problem is concentrated in high-position branded-confusion queries, not broad low-rank discovery. The page export has 266 impressions, 22 clicks, and 8.27% CTR. The keyword export has 247 impressions, 22 clicks, and 8.91% CTR. `excalicord` and `excalicord 白板` alone account for 198 impressions and 14 clicks, with average positions around 2.7-3.2. That is the highest-impact CTR opportunity because Excalicast is already being shown near the top, but users likely expect Excalicord.

The current technical SEO foundation is mostly solid: the homepage emits locale-specific canonical/hreflang; content pages use canonical/hreflang through `pageMetadata`; comparison and use-case detail pages emit FAQPage and BreadcrumbList JSON-LD; private app/export/library/share surfaces are noindexed through layouts. The largest organic CTR gap is therefore title/snippet intent alignment, not missing canonical tags.

Highest-priority action: route brand-confusion demand to a clearer Chinese Excalicord comparison experience. The current `/zh` homepage receives 248 impressions and 22 clicks, while `/zh/compare/excalicast-vs-excalidraw` has only 2 impressions and `/zh/compare/excalicast-vs-excalicord` does not appear in the page export. The site already has a factual Excalicord comparison page, but Google appears to prefer the homepage for Excalicord terms. Make the homepage and internal links explicitly point searchers to "Excalicast 与 Excalicord 不是同一产品" and strengthen the comparison page's title, description, H1 lead, and anchors.

## Data Read

Source files:

- `/Users/chenzhijiang/Downloads/excalicast.cc_PageTrafficReport_7_22_2026.csv`
- `/Users/chenzhijiang/Downloads/excalicast.cc_KeywordReport_7_22_2026.csv`

Top page data:

| Page | Impr. | Clicks | CTR | Avg. pos. | Read |
|---|---:|---:|---:|---:|---|
| `https://excalicast.cc/zh` | 248 | 22 | 8.87% | 2.93 | Main CTR battleground. High rank, weak branded-confusion capture. |
| `/zh/use-cases/record-whiteboard-lecture` | 4 | 0 | 0% | 7.25 | Low sample; title is useful but can better mirror Chinese query phrasing. |
| `/zh/app` | 4 | 0 | 0% | 4.25 | Private/product app intent; noindex should be preserved if emitted by layout. |
| `/zh/use-cases` | 4 | 0 | 0% | 9.00 | Needs internal links and more precise "白板录视频" language. |
| `/zh/compare/excalicast-vs-excalidraw` | 2 | 0 | 0% | 6.50 | Relevant to "excalidraw 可以录视频"; too little exposure. |
| `/en/use-cases/record-math-tutorial` | 2 | 0 | 0% | 1.00 | Rank is excellent; sample too small to judge. |

Top query data:

| Query | Impr. | Clicks | CTR | Avg. pos. | Opportunity |
|---|---:|---:|---:|---:|---|
| `excalicord` | 102 | 5 | 4.90% | 3.20 | Very high. Searcher likely wants a different brand; title must clarify relationship fast. |
| `excalicord 白板` | 96 | 9 | 9.38% | 2.68 | Very high. Add Chinese comparison snippets and homepage module. |
| `excalicord下载` | 5 | 0 | 0% | 3.40 | Do not promise a download. Mention "浏览器打开 Excalicast" and "不是 Excalicord 下载页". |
| `https www excalicord com` | 4 | 0 | 0% | 4.00 | Navigational to Excalicord; likely low-quality traffic. Capture only with honest comparison. |
| `白板录视频软件ex` | 4 | 0 | 0% | 2.50 | Good generic intent; can be won with Chinese homepage/use-case copy. |
| `excalidraw可以录视频` | 4 | 1 | 25% | 4.00 | Push Excalidraw comparison page. |
| `excalirec白板录屏` | 4 | 1 | 25% | 4.25 | Existing ExcaliRec comparison is the right page; improve internal links/anchors. |

## Current SEO Implementation

Current implementation observed:

- `src/app/[locale]/layout.tsx` sets `metadataBase`, default title template, default description, OpenGraph, Twitter, and `html lang`.
- `src/app/[locale]/page.tsx` sets absolute localized homepage title/description and `buildAlternates('/')`.
- `src/lib/seo/alternates.ts` emits canonical URLs with always-prefixed locale routes: `/zh`, `/en`; hreflang maps `zh` to `zh-CN`, `en` to `en`; `x-default` points to `/en`.
- `src/lib/seo/meta.ts` centralizes content metadata, canonical/hreflang, OpenGraph, and Twitter for programmatic pages.
- `src/app/[locale]/compare/[slug]/page.tsx` and `src/app/[locale]/use-cases/[slug]/page.tsx` emit FAQPage and BreadcrumbList JSON-LD.
- `src/lib/seo/schema.ts` emits SoftwareApplication, Organization, FAQPage, and BreadcrumbList builders.
- `tests/e2e/seo-pages.spec.ts` explicitly checks canonical/hreflang and FAQ/Breadcrumb for the Excalicord comparison page.

Observed copy/intent mismatch:

- Chinese homepage title: `Excalicast — 一站式录制内容工作台`
- Chinese homepage description: `从白板录制、剪辑、字幕、多平台导出到云端归档，一次讲解沉淀为可复用的内容资产。`
- This is polished brand positioning, but it does not match the strongest current queries: `excalicord`, `excalicord 白板`, `白板录视频软件ex`, `excalidraw可以录视频`.
- The product does have relevant Excalicord/ExcaliRec/Excalidraw comparison pages in `src/content/compare.ts`, but Search Console suggests Google is mainly showing `/zh`, not the intended comparison pages.

## Google Constraints That Matter

Use these constraints when interpreting any CTR experiment:

- Google may generate title links from the `<title>` element, main visual title, headings, prominent page text, and links pointing at the page. Source: [Google title link documentation](https://developers.google.com/search/docs/appearance/title-link).
- Google may generate snippets from page content as well as the meta description. A meta description can help, but it is not guaranteed to be shown. Source: [Google snippet documentation](https://developers.google.com/search/docs/appearance/snippet).
- Canonical selection is a hint-informed process; use consistent canonical URLs and hreflang alternates, but do not assume the declared canonical fully controls what Google displays. Source: [Google canonicalization docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
- Localized pages should identify alternates with hreflang and reciprocal links. The current `buildAlternates` approach matches that direction. Source: [Google localized versions docs](https://developers.google.com/search/docs/specialty/international/localized-versions).
- FAQ rich results are no longer a realistic CTR lever for most sites; Google limited FAQ rich results visibility to authoritative government and health sites in 2023. Keep FAQ schema only for clarity/AI extraction, not as a rich-result promise. Source: [Google FAQ structured data update](https://developers.google.com/search/blog/2023/08/howto-faq-changes).
- Breadcrumb rich results remain realistic if markup is valid and page hierarchy is clear. Source: [Google Breadcrumb structured data docs](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb).
- Software app structured data can describe the app entity, but it does not guarantee a rich result for these queries. Source: [Google Software App structured data docs](https://developers.google.com/search/docs/appearance/structured-data/software-app).

## Impact-Ranked Opportunities

### P0: Excalicord Brand-Confusion Capture

Affected queries:

- `excalicord`: 102 impressions, 5 clicks, 4.90% CTR, avg. position 3.20
- `excalicord 白板`: 96 impressions, 9 clicks, 9.38% CTR, avg. position 2.68
- `excalicord下载`, `excalicord 官网`, `https www excalicord com`, `excalicord.com`: smaller volume but strongly navigational

Likely intent:

- Many users want Excalicord specifically, not Excalicast.
- Some users are comparing whiteboard recorders and may accept an honest alternative if the snippet quickly says the products are different.

Recommended page target:

- Primary: `/zh/compare/excalicast-vs-excalicord`
- Secondary: `/zh`

Recommended content changes:

- Add a homepage section or FAQ line near the first crawlable content: `Excalicast 和 Excalicord 是同一个产品吗？不是。Excalicast 是独立的浏览器白板录制与剪辑工作流；如果你在找 Excalicord，可先看两者差异。`
- Add internal link from homepage to `/zh/compare/excalicast-vs-excalicord` with anchor text: `Excalicast 与 Excalicord 对比` and a secondary anchor `Excalicord 白板录制替代方案`.
- On the comparison page, move the "not the same product" clarification into the first 1-2 sentences, before feature breadth claims.
- Avoid "下载" promises. Excalicast is a browser app; do not frame the page as an Excalicord download destination.

Title/description A/B:

| Variant | Page | Title | Description | Why |
|---|---|---|---|---|
| A | `/zh/compare/excalicast-vs-excalicord` | `Excalicast vs Excalicord：白板录制工具对比` | `Excalicast 和 Excalicord 不是同一产品。对比白板录制、摄像头、在线剪辑、字幕、多比例 MP4 导出与适用场景。` | Directly matches query and disambiguates. |
| B | `/zh/compare/excalicast-vs-excalicord` | `Excalicord 替代方案？先看 Excalicast 对比` | `如果你在找 Excalicord 白板录制，这里客观对比 Excalicast 与 Excalicord：录制来源、剪辑、字幕、导出和公开说明的功能边界。` | Better for "alternative" and confused navigational searches. |
| A | `/zh` | `Excalicast：浏览器白板录制、剪辑与多比例导出` | `基于 Excalidraw 的白板录视频工具。采集画板和语音，在线剪辑，导出 16:9、9:16、1:1、4:5 MP4，可选字幕和讲义。` | More concrete than "内容工作台"; mirrors generic query intent. |
| B | `/zh` | `Excalicast 白板录视频工具：一次录制，多比例 MP4` | `无需安装即可录制白板讲解：同步语音、可选摄像头、浏览器剪辑、本地渲染 MP4。Excalicord/ExcaliRec 对比见站内说明。` | Captures generic "白板录视频工具" while giving brand-confusion path. |

Google rewrite risk:

- High for the homepage if the visible hero H1 remains poetic (`让讲过的内容，有可以留下的位置`) while the `<title>` becomes functional. Google may prefer visible H1/prominent text or anchor text.
- Lower for the comparison page if the H1, title, intro, breadcrumb, and internal anchors all repeat the comparison intent consistently.

Expected impact:

- If comparison page gets selected for Excalicord queries and CTR rises from 7.1% blended to 12-16%, this cluster can add roughly 10-18 clicks per 28 days at current impressions.
- If CTR falls, that may still be acceptable if impressions are mostly navigational to Excalicord and not qualified.

### P1: Chinese Generic Whiteboard Recording Intent

Affected queries:

- `白板录视频软件ex`: 4 impressions, 0 clicks, avg. position 2.5
- `白板录视频`: 2 impressions, 1 click, avg. position 5.5
- `屏幕录制 白板`: 2 impressions, 1 click, avg. position 3.5
- `白板录视频工具`: 1 impression, 1 click, avg. position 1
- `录屏白板`: 1 impression, 0 clicks, avg. position 1
- `画板写字讲解录制`: 1 impression, 1 click, avg. position 1

Recommended page target:

- Primary: `/zh`
- Secondary: `/zh/use-cases/record-whiteboard-lecture`

Recommended content changes:

- Make "白板录视频工具" appear in visible copy near the homepage hero or first capabilities section.
- Add an internal link from the homepage and use-cases index to `/zh/use-cases/record-whiteboard-lecture` using `录制白板讲座` and `白板录视频教程`.
- Rewrite the use-case intro to include common Chinese phrasing: `白板录视频`, `画板写字讲解录制`, `无需传统录屏`.

Title/description A/B:

| Variant | Page | Title | Description |
|---|---|---|---|
| A | `/zh/use-cases/record-whiteboard-lecture` | `白板录视频教程：录制讲座并导出 MP4` | `用 Excalicast 在浏览器录制白板讲解：同步语音、抗遮挡、无需传统录屏，完成后导出横屏或竖屏 MP4。` |
| B | `/zh/use-cases/record-whiteboard-lecture` | `如何录制白板讲座：无需录屏软件` | `打开浏览器即可边写边讲录制白板课，采集画板操作和麦克风音频，导出 16:9 或 9:16 MP4。` |

Google rewrite risk:

- Medium. Current H1 already says `如何录制白板讲座（无需录屏）`, so Google is likely to preserve a functional title if the visible lead also uses "白板录视频".

### P2: Excalidraw Recording Intent

Affected queries:

- `excalidraw可以录视频`: 4 impressions, 1 click, avg. position 4
- `excalidraw 录屏 slid`: 1 impression, 1 click, avg. position 6
- `excalidraw怎么录制`: 1 impression, 0 clicks, avg. position 3

Recommended page target:

- `/zh/compare/excalicast-vs-excalidraw`

Current title is already strong: `Excalidraw 能录视频吗？Excalicast 给 Excalidraw 加上录制`. Keep this direction.

Recommended content changes:

- Add homepage/use-case internal links with exact Chinese anchors:
  - `Excalidraw 可以录视频吗？`
  - `把 Excalidraw 白板录成 MP4`
  - `Excalidraw 录屏替代方案`
- Add a first-screen answer block: `Excalidraw 本身是白板画布，不内置带语音的视频录制；Excalicast 基于 Excalidraw 画布增加录制、语音和 MP4 导出。`

Title/description A/B:

| Variant | Page | Title | Description |
|---|---|---|---|
| A | `/zh/compare/excalicast-vs-excalidraw` | `Excalidraw 可以录视频吗？用 Excalicast 导出 MP4` | `Excalidraw 本身不内置视频录制。Excalicast 基于 Excalidraw 画布，录制操作流和语音，导出多比例 MP4。` |
| B | `/zh/compare/excalicast-vs-excalidraw` | `把 Excalidraw 白板录成视频：Excalicast 对比` | `对比 Excalidraw 与 Excalicast：画布、语音录制、MP4 导出、多比例复用，以及什么时候只用 Excalidraw 就够。` |

Google rewrite risk:

- Low to medium because query wording aligns with H1 and title.

### P3: ExcaliRec Brand-Comparison Intent

Affected query:

- `excalirec白板录屏`: 4 impressions, 1 click, 25% CTR, avg. position 4.25

Recommended page target:

- `/zh/compare/excalicast-vs-excalirec`

Recommended content changes:

- Add internal anchors from `/zh/compare`, `/zh/use-cases/record-whiteboard-content`, and Excalicord comparison page.
- Keep claims conservative. Current copy correctly says ExcaliRec publicly documents whiteboard-native recording, auto zoom, webcam, styling, and local WebM download. Do not claim missing features are absent; mark them as publicly undocumented.

Title/description A/B:

| Variant | Page | Title | Description |
|---|---|---|---|
| A | `/zh/compare/excalicast-vs-excalirec` | `Excalicast vs ExcaliRec：白板录屏工作流对比` | `对比 Excalicast 与 ExcaliRec：白板采集、自动缩放、摄像头、本地导出、在线剪辑、字幕、讲义和多比例输出。` |
| B | `/zh/compare/excalicast-vs-excalirec` | `ExcaliRec 替代方案？看 Excalicast 白板录制对比` | `ExcaliRec 适合轻量白板录制；Excalicast 覆盖白板、标签页、窗口、桌面采集，以及剪辑、字幕和多格式导出。` |

Google rewrite risk:

- Medium. If the page's visible content focuses broadly on workflow rather than "ExcaliRec 白板录屏", Google may shorten or rewrite.

### P4: English Micro-Intent: Math Tutorial

Affected query:

- `whiteboard math video recording tips`: 2 impressions, 0 clicks, avg. position 1

Recommended page target:

- `/en/use-cases/record-math-tutorial`

Sample size is too small for a strong conclusion, but position 1 with zero clicks suggests the snippet may be too product-led for an informational query.

Title/description A/B:

| Variant | Page | Title | Description |
|---|---|---|---|
| A | `/en/use-cases/record-math-tutorial` | `How to Record a Math Tutorial on a Whiteboard` | `A practical workflow for recording math or science explanations: write each step, narrate your reasoning, and export a clean MP4 for YouTube or Shorts.` |
| B | `/en/use-cases/record-math-tutorial` | `Whiteboard Math Video Recording Tips for Teachers` | `Plan readable equations, record voice with each step, and export one whiteboard lesson as both landscape and vertical video with Excalicast.` |

Google rewrite risk:

- Medium. Query says "tips", but page title says "how to record"; add a visible "Recording tips" section if choosing B.

## Rich Result Feasibility

Realistic:

- BreadcrumbList on comparison/use-case pages. Already implemented.
- SoftwareApplication entity on homepage. Already implemented; ensure prices and featureList stay current and do not promise unavailable features.

Limited or not reliable:

- FAQPage. Keep for structured Q&A clarity, but do not expect FAQ rich-result expansion in SERP because Google reduced FAQ rich results to authoritative government/health sites.
- Review/rating rich results. Not feasible unless Excalicast has genuine first-party review content that meets Google review snippet policies. Do not invent ratings.
- Video rich results. Not ready unless there are public indexable videos with thumbnails, durations, transcripts, and VideoObject markup. Current app exports/private playback should not be forced into indexation.
- HowTo rich results. Google has substantially reduced HowTo visibility and eligibility; use how-to content for relevance and snippets, not as a guaranteed rich result.

## Internal Linking Plan

Add or adjust links, in priority order:

1. Homepage `/zh` first screen or first crawlable section:
   - Anchor: `Excalicast 与 Excalicord 对比`
   - Target: `/zh/compare/excalicast-vs-excalicord`
   - Context: "如果你在搜索 Excalicord，这里是两者差异。"

2. Homepage `/zh` capabilities or FAQ:
   - Anchor: `白板录视频教程`
   - Target: `/zh/use-cases/record-whiteboard-lecture`

3. `/zh/compare` index:
   - Make Excalicord, ExcaliRec, and Excalidraw comparisons visible near the top if they are not already prioritized by order.
   - Use visible metadata labels, not only "Excalicast vs X".

4. `/zh/use-cases/record-whiteboard-lecture`:
   - Link to `/zh/compare/excalicast-vs-excalidraw` with `Excalidraw 可以录视频吗？`
   - Link to `/zh/compare/excalicast-vs-screen-recording` with `白板录屏和操作流录制有什么区别？`

5. `/zh/compare/excalicast-vs-excalicord`:
   - Link to `/zh/compare/excalicast-vs-excalirec` with `ExcaliRec 白板录屏对比`.
   - Link to `/zh/use-cases/record-whiteboard-content` if keeping the broader "capture-to-publish" workflow page.

## Content Rewrite Guidance

Homepage Chinese:

- Current positioning is elegant but abstract. For organic CTR, add one concrete sentence near the top:
  - `Excalicast 是一款浏览器白板录视频工具：录制 Excalidraw 画板、语音和可选摄像头，在线剪辑后导出横屏、竖屏、方形 MP4。`
- Keep "一站式录制内容工作台" as brand language, but do not make it the only snippet candidate.

Excalicord comparison:

- Put disambiguation first:
  - `Excalicast 和 Excalicord 不是同一个产品。Excalicord 公开定位为白板视频录制器；Excalicast 面向白板、标签页、窗口或桌面采集后的剪辑、字幕、讲义与多比例导出。`
- Do not use language that implies Excalicast is the official Excalicord site.
- Do not add a fake "Excalicord 下载" CTA. CTA should be `打开 Excalicast 录制器` or `查看功能差异`.

ExcaliRec comparison:

- Preserve "publicly documented" wording. It protects credibility and avoids unsupported claims.
- Use "WebM" and "MP4" carefully: ExcaliRec publicly documents local WebM output; Excalicast exports MP4. Do not say ExcaliRec cannot produce MP4 if their docs say conversion is possible.

Use-case pages:

- Add "tips" and "教程" sections where the queries imply informational intent.
- Keep feature claims aligned to real entitlements:
  - Free: recording + watermarked MP4 export, no account.
  - One-time: unlock a recording's watermark-free export.
  - Pro: subtitles.
  - Max: structured handouts/share links where eligible.

## CTA Recommendations

For comparison pages:

- Primary CTA: `打开 Excalicast 录制器`
- Secondary CTA: `查看白板录视频教程`
- Avoid: `下载 Excalicord`, `导入 Excalicord`, or any CTA that suggests affiliation.

For generic use-case pages:

- Primary CTA: `开始录制白板视频`
- Secondary CTA: `查看与传统录屏的区别`

For English informational pages:

- Primary CTA: `Open the recorder`
- Secondary CTA: `See whiteboard recording tips`

## 28-Day Experiment Design

Principle: change one cluster at a time where possible. Search Console data is small, so treat this as directional rather than statistically conclusive.

### Experiment 1: Excalicord CTR Rescue

Duration: 28 days after deployment and reindexing request.

Change set:

- Update `/zh/compare/excalicast-vs-excalicord` title/description to Variant A.
- Add visible first-paragraph disambiguation.
- Add homepage internal link to the comparison page.
- Add homepage concrete "白板录视频工具" sentence without replacing product truth.

Primary query group:

- `excalicord`
- `excalicord 白板`
- `excalicord下载`
- `excalicord 官网`
- `https www excalicord com`
- `excalicord.com`

Primary metrics:

- CTR for query group.
- Clicks for query group.
- Landing page split: `/zh` vs `/zh/compare/excalicast-vs-excalicord`.
- Average position.

Guardrails:

- Bounce/progression if available in internal analytics: organic landing to `cta_start_recording`, `app_open`, or compare page depth.
- Do not judge success only by CTR. Some Excalicord navigational searches are not qualified and may correctly not click.

Success threshold:

- Query-cluster CTR improves from roughly 7.1% blended to 11%+ without average position dropping by more than 0.5.
- At least 20% of Excalicord-cluster clicks land on the comparison page.

### Experiment 2: Chinese Generic Whiteboard Intent

Duration: next 28-day window after Experiment 1, or concurrent only if tracking query groups separately.

Change set:

- Update `/zh/use-cases/record-whiteboard-lecture` title/description to Variant A.
- Add "白板录视频教程" visible section.
- Add homepage and use-case index links.

Primary query group:

- `白板录视频`
- `白板录视频软件ex`
- `白板录视频工具`
- `画板写字讲解录制`
- `屏幕录制 白板`
- `录屏白板`

Success threshold:

- Maintain average position top 5 and reach 12%+ CTR for the group once impressions exceed 30.

### Experiment 3: Excalidraw Recording Page Selection

Duration: 28 days.

Change set:

- Keep or test `/zh/compare/excalicast-vs-excalidraw` Variant A.
- Add exact-match internal anchors from homepage/use-case pages.

Primary query group:

- `excalidraw可以录视频`
- `excalidraw怎么录制`
- `excalidraw 录屏`
- `excalidraw 录成视频`

Success threshold:

- Comparison page becomes the dominant landing page for this query group.
- CTR remains above 15% when impressions exceed 20.

## Measurement Notes

Before launch:

- Export current 28-day Search Console query/page data as the baseline.
- Annotate deployment date.
- Request indexing for changed pages in Search Console if available.
- Confirm rendered HTML includes desired title, description, canonical, hreflang, and JSON-LD.

During test:

- Check at day 7 only for indexing/page selection, not final CTR.
- Check at day 14 for obvious title rewrites.
- Decide at day 28.

After test:

- Compare query clusters, not just individual queries.
- Segment by page landing.
- Keep changes that improve qualified clicks even if raw CTR is flat.
- If Google rewrites titles, adjust visible H1/lead/internal anchors before changing meta again.

## Factors Google May Rewrite Or Ignore

Likely rewrite candidates:

- Homepage title if visible H1 remains more poetic than the target query.
- Meta description if it is generic or if query terms appear more strongly in body text.
- Brand-confusion snippets where Google sees external/internal anchors mentioning Excalicord.
- FAQ snippets, because FAQ rich results are restricted and snippets may be pulled from body text.

Less likely to be ignored:

- Canonical/hreflang when reciprocal, consistent, and not contradicted by redirects.
- BreadcrumbList if rendered validly and hierarchy is clear.
- Comparison page title if `<title>`, H1, lead, breadcrumb, and internal anchors align.

## Do Not Do

- Do not create "Excalicord download" pages or CTAs unless Excalicast actually provides an Excalicord download, which it does not.
- Do not claim affiliation with Excalicord, ExcaliRec, or Excalidraw.
- Do not invent competitor feature gaps. Use "publicly documented" / "not publicly documented" where evidence is limited.
- Do not index private app/export/library pages to chase impressions.
- Do not rely on FAQ schema as the CTR strategy.

## Most Important Finding

Excalicast already has rankings for the wrong-brand cluster. The fastest CTR lift is not more schema; it is honest disambiguation plus comparison-page routing: make Google and users understand that `Excalicord` searchers should see a clear `Excalicast vs Excalicord` result, while generic `白板录视频` searchers should see a concrete browser whiteboard recorder result.
