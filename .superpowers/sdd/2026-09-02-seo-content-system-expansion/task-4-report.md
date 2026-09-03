# Task 4 Report

- Status: completed as intentional RED; the quality contracts are in place and failing for absent or undersized content rather than import, parser, or config errors.
- Baseline: `7a9adf5a2f8f0417e7bba51a139c8212a7134572`
- Branch: `fix/loading-recording`

## Files

- Created `tests/e2e/seo-content-quality.spec.ts`
- Modified `tests/e2e/seo-routes.spec.ts`
- Modified `docs/development-log.md`

## Test design

- Added a quote-aware CSV parser in the new static Playwright spec and used it to enforce Task 3 keyword-scale and one-primary-target mapping contracts.
- Added five Top3 core-article depth tests against the existing `BLOG_ENTRIES` slugs, counting English words from title, description, intro, body, future structured blocks, and FAQs.
- Added a short-paragraph ceiling contract that inspects only English prose paragraphs and explicitly skips table/checklist/code/example-style structured blocks.
- Added a structured-evidence contract that requires at least two media blocks, one decision aid, and one limitation or reality-check block for the five core articles.
- Added a sitemap reservation contract for all distinct `wave=1|2|3` planned slugs so future production work must create both `en` and `zh` blog URLs.

## Verification

- Command: `npx playwright test tests/e2e/seo-content-quality.spec.ts tests/e2e/seo-routes.spec.ts --reporter=line`
- Result: `8 failed, 15 passed (26.2s)`
- Exact expected failing assertion names:
  - `how-to-screen-record-on-windows-11 English total word count`
  - `screencasting-guide English total word count`
  - `best-screen-recorder-for-mac English total word count`
  - `whiteboard-animation-and-hand-drawn-explainers English total word count`
  - `whiteboard-animation-software-comparison English total word count`
  - `how-to-screen-record-on-windows-11 Pick the right Windows 11 screen recorder paragraph 1 exceeds the 240-character paragraph ceiling`
  - `how-to-screen-record-on-windows-11 visual evidence block count`
  - `record-screen-with-audio-on-mac should exist in BLOG_ENTRIES`

## Commit

- Pending at report write time; committed after verification as `test(seo): enforce content system quality gates`.

## Self-review

- Confirmed the new CSV contracts pass before the intentional quality failures begin, which proves the parser and file wiring are correct.
- Confirmed the new planned-slug test fails on the first absent wave slug rather than on slug-count math or sitemap import issues.
- Kept all assertions deterministic and data-local; no page navigation is needed in the new quality spec.

## Concerns

- The same quote-aware CSV parser currently exists in both SEO specs; if more content-system tests need CSV reads, it will be worth extracting a shared test helper in a later green task.
