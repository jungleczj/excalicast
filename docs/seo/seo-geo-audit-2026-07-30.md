# SEO / GEO Audit Baseline

## Method

This audit applies the installed `seo-audit`, `ai-seo`, `competitors`, `cro`, `analytics`, `product-marketing`, and `entity-seo` skills to the current codebase and the supplied 28-day Search Console exports.

The requested upstream skill names changed before installation:

- `competitor-alternatives` is currently published as `competitors`.
- `page-cro` is currently published as `cro`.
- `analytics-tracking` is currently published as `analytics`.
- `product-marketing-context` is currently published as `product-marketing`.
- `generative-engine-optimization` is no longer present in its source repository; its current entity-disambiguation replacement is `entity-seo`.

## Search Baseline

- Keyword rows: 26
- Impressions: 247
- Clicks: 22
- CTR: 8.91%
- Page impressions: 266
- Page clicks: 22
- `/zh` share of page impressions: 248 / 266 (93.2%)
- Non-home content clicks: 0
- `excalicord` / `excalirec` family: 225 keyword impressions

## Priority Findings

### P0: Private localized routes remain crawlable

`robots.ts` blocks unlocalized `/app`, `/library`, and `/s/`, while real routes include locale prefixes. Search Console already reports `/zh/app`.

### P0: Brand entities are ambiguous

Search demand is concentrated around Excalicord and ExcaliRec. Excalicast needs a stable Organization ID, a stable SoftwareApplication ID, a canonical logo URL, visible disambiguation, and sourced comparison pages.

### P0: Content discovery does not become product use

Content pages have a bottom CTA, but the persistent header CTA is not tracked. The analytics model does not preserve session-entry attribution or expose content-to-recording conversion by landing page.

### P1: The site undersells the shipped workflow

Existing SEO content is whiteboard-centric while the product now supports display sources, timeline editing, ChatCut-assisted editing, editable Autozoom regions, captions, handouts, multi-ratio export, and share links.

### P1: Extractable page structure is incomplete

The content data model has an intro, table or steps, FAQ, and related links, but lacks explicit direct-answer, best-for, limitations, facts, source, and verification-date blocks.

### P1: Sitemap omits a public conversion page

The public pricing route is linked from the homepage but absent from the sitemap.

## Claim Guardrails

- "Publish-ready" means files, captions, handouts, and links prepared in one workflow.
- Do not claim direct publishing to YouTube, Douyin, TikTok, or other third-party platforms.
- Describe Autozoom as editable focus regions unless automatic focus generation is verified.
- Describe undocumented competitor capabilities as "not publicly documented".
- JSON-LD must match visible page content.

## Measurement Decisions

Primary funnel:

`organic landing -> content CTA -> recording setup -> source selected -> recording start -> recording complete -> export success`

The first release establishes a clean baseline. Conversion improvement targets are evaluated against the first complete 28-day period after instrumentation.

## Implementation Status

- Resolved: localized private routes are disallowed in `robots.txt` and emit page-level `noindex`.
- Resolved: `/pricing` and every localized content route are present in the sitemap.
- Resolved: Organization and SoftwareApplication use stable entity IDs and the canonical icon URL.
- Resolved: legal-page titles, canonicals, and hreflang metadata are consistent.
- Shipped: five sourced comparison pages, including Excalicord, and one bilingual end-to-end pillar page.
- Shipped: visible direct answers, fit guidance, workflows, facts, limitations, sources, and verification dates.
- Shipped: session entry attribution and the organic/content-to-export funnel, grouped by landing page, content intent, locale, source type, and traffic type.
- Shipped: a 140-row GEO benchmark generated from 35 prompts across four platforms. All rows remain explicitly unmeasured until real platform answers are collected.
- Verified: typecheck, production build, four static SEO tests, and five rendered-page SEO/CRO tests pass.
- Existing regression debt: three unrelated recording/editor E2E assertions remain reproducibly failing and are documented in the implementation close-out.
