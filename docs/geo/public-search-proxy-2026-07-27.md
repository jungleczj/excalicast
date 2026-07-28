# Excalicast Public Search Proxy Check — 2026-07-27

This is a public-search proxy, not a ChatGPT / Gemini / Google AI Overview / Perplexity answer-rate measurement.

Purpose:

- check whether Excalicast-owned pages appear for GEO-relevant query clusters;
- identify entity-confusion risks that answer engines may pick up;
- decide which pages need stronger direct-answer and external corroboration.

## Method

Search spot-checks were run for English and Chinese query clusters related to:

- Excalidraw recording;
- recording without screen capture;
- Loom / whiteboard explainer alternatives;
- local-first recording;
- MP4 / webcam / subtitles;
- archive and searchable content assets.

## Observed Excalicast-owned results

| Cluster | Observed owned URL | Why it matters |
|---|---|---|
| Brand / homepage | `https://excalicast.cc/en` | Homepage is crawlable and contains the new one-workspace positioning: record, shape, caption, publish, archive. |
| No-screen-recording / operation stream | `https://excalicast.cc/en/blog/record-whiteboard-without-screen-recording` | Strong GEO seed for “record Excalidraw / whiteboard without screen recording”. |
| Course / subtitles | `https://excalicast.cc/en/use-cases/record-online-course-lesson` | Good support for online teaching + captions, but currently English result appeared for Chinese query intent too. |
| Comparisons | `https://excalicast.cc/en/compare` | Useful comparison hub, but needs more external links and stronger snippets. |

## Observed entity-confusion risks

| Confuser | URL | Risk |
|---|---|---|
| ExcaliCast iOS product | `https://excalicast.com/` | Very high. Same name with different capitalization and `.com`; may be mistaken for this product. |
| Excalicord | `https://www.excalicord.com/` | Very high. Search Console shows most impressions come from `excalicord` queries. |
| ExcaliRec | `https://excalirec.com/` | High. Strong Excalidraw recorder positioning; likely to appear in AI answers for the same category. |
| ExcalidrawRecorder / Poindeo | `https://excalidrawrecorder.com/` | Medium. Owns broad “record Excalidraw” education intent. |
| Screency | `https://www.screency.com/` | Medium. Whiteboard + webcam + MP4 wording overlaps with Excalicast. |
| Explideo | `https://explideo.app/` | Medium. Whiteboard video maker / MP4 export overlaps in broad queries, but not Excalidraw-specific. |
| Excalimate | `https://excalimate.com/` | Medium. Excalidraw to animation/export category; can compete for “Excalidraw to video” searches. |

## Proxy conclusions

1. **Excalicast has crawlable owned answers, but not enough entity authority.**
   - The site can answer many of the 20 prompts.
   - Competing/confusing domains are likely to be cited unless Excalicast builds stronger external corroboration.

2. **The brand problem is P0.**
   - The Search Console CSV shows `excalicord` dominates impressions.
   - Public search also surfaces `excalicast.com`, a different product.
   - GEO systems may mix these unless `llms.txt`, FAQ, schema, and external profiles consistently state the canonical domain.

3. **Chinese query intent is under-served by Chinese pages.**
   - English pages appeared for some Chinese-intent spot checks.
   - Priority should be strengthening `/zh` use-case and comparison pages with direct-answer Chinese copy.

4. **Archive/searchable-assets is the weakest unique-positioning page cluster.**
   - Homepage says “archive” and “searchable”, but there is not yet a dedicated page that answer engines can cite.

## Recommended next actions

### Immediate

- Add canonical entity language to `/llms.txt`.
- Add visible FAQ: “Is Excalicast the same as Excalicord / ExcaliRec / ExcaliCast?”
- Fix localized robots for `/zh/app`, `/en/app`, `/zh/library`, `/en/library`, `/zh/s/`, `/en/s/`.
- Fix legal-page title duplication.

### Content

- Create a dedicated “record Excalidraw to video” page in both English and Chinese.
- Create a dedicated “whiteboard recording with subtitles” page.
- Create a dedicated “recording archive / searchable content assets” page.
- Strengthen `excalicast-vs-excalirec` and `excalicast-vs-excalidraw` comparison pages.

### External corroboration

- Add accurate listings to SaaSHub / alternatives directories / Product Hunt-style directories.
- Publish a short public changelog or docs page describing the product factually.
- If `excalicord.com` is owned, redirect it. If not owned, clarify canonical identity without claiming ownership.

## How this relates to the 80-check AI benchmark

This proxy check does not fill `excalicast_score` in the benchmark CSV.

The true benchmark still requires running:

- 20 prompts in ChatGPT Search;
- 20 prompts in Gemini;
- 20 prompts in Google AI Overview / AI Mode;
- 20 prompts in Perplexity.

After those fields are filled, run:

```bash
npm run geo:score -- docs/geo/benchmark-results-YYYY-MM-DD.csv
```

Only then should Excalicast’s true AI-answer up-rate be reported.
