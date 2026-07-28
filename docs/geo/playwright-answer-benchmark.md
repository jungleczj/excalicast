# Excalicast GEO / AI Answer Benchmark with Playwright

This benchmark measures whether Excalicast appears in answer engines and AI-search-like surfaces for high-intent questions.

It does not fabricate ChatGPT / Gemini / Perplexity / Google AI Overview results. The Playwright runner stores raw answer text so every score can be audited.

## 1. Generate the question set

Use the canonical 20 benchmark prompts plus extra prompts derived from Search Console keyword/page exports:

```bash
npm run geo:generate -- \
  --keyword-csv /Users/chenzhijiang/Downloads/excalicast.cc_KeywordReport_7_22_2026.csv \
  --page-csv /Users/chenzhijiang/Downloads/excalicast.cc_PageTrafficReport_7_22_2026.csv \
  --out docs/geo/benchmark-results-$(date +%F).csv
```

Use only the canonical 20 prompts:

```bash
npm run geo:generate -- --core-only --out docs/geo/benchmark-results-$(date +%F).csv
```

## 2. Run Playwright collection

Public Google collection:

```bash
npm run geo:run -- \
  --input docs/geo/benchmark-results-$(date +%F).csv \
  --platform google \
  --limit 5 \
  --allow-external
```

Perplexity / ChatGPT / Gemini often require login or bot checks. Use a persistent profile and headed browser:

```bash
npm run geo:run -- \
  --input docs/geo/benchmark-results-$(date +%F).csv \
  --platform perplexity \
  --headed \
  --channel chrome \
  --profile-dir tmp/geo-browser-profile \
  --manual-login-ms 120000 \
  --allow-external
```

For ChatGPT and Gemini:

```bash
npm run geo:run -- \
  --input docs/geo/benchmark-results-$(date +%F).csv \
  --platform chatgpt \
  --headed \
  --channel chrome \
  --profile-dir tmp/geo-browser-profile \
  --manual-login-ms 120000 \
  --allow-external
```

If the platform shows a login page, log in once in the visible browser and rerun with the same `--profile-dir`.
If the platform shows Cloudflare / captcha / Google unusual-traffic checks, complete the check manually in the visible browser and rerun. The script marks those rows as unmeasured until a completed answer is visible.

Useful filters:

```bash
--limit 3
--prompt-id 18
--locale zh
--platform all
--channel chrome
--manual-login-ms 120000
--dry-run
```

## 3. Analyze answer visibility

```bash
npm run geo:analyze -- \
  --input docs/geo/benchmark-results-$(date +%F).csv \
  --out docs/geo/answer-benchmark-report-$(date +%F).md
```

The existing scorecard still works:

```bash
npm run geo:score -- docs/geo/benchmark-results-$(date +%F).csv
```

## Scoring rubric

- `1.0`: Excalicast is recommended or cited with the correct name / URL.
- `0.5`: Excalicast is mentioned but not clearly recommended or cited.
- `0`: Excalicast is absent.
- `wrong_brand_flag`: likely entity confusion, such as Excalicord / Excalirec.

## What to improve from the report

Treat the report as a backlog generator:

- Absent on high-intent prompts → add a direct answer block and FAQ to the relevant page.
- Mentioned but not cited → strengthen citation signals: JSON-LD, clear headings, public demo, directory listing, external corroboration.
- Wrong-brand confusion → add a brand correction page and repeat canonical naming across homepage, `llms.txt`, FAQ, and external profiles.
- Competitor-heavy answers → create fair comparison pages for the repeated competitors.
