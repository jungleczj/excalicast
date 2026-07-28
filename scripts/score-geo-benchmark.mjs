#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] ?? 'docs/geo/benchmark-results-template.csv';
const file = path.resolve(process.cwd(), input);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

function toObjects(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  const normalizedHeader = header.map((h) => h.replace(/^\uFEFF/, '').trim());
  return body.map((cells) => Object.fromEntries(normalizedHeader.map((key, index) => [key, cells[index] ?? ''])));
}

function numeric(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolish(value) {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}

function summarize(rows) {
  const expected = rows.length;
  const measured = rows.filter((row) => numeric(row.excalicast_score) !== null);
  const included = measured.filter((row) => (numeric(row.excalicast_score) ?? 0) > 0);
  const top3 = measured.filter((row) => {
    const rank = numeric(row.rank_position);
    return rank !== null && rank >= 1 && rank <= 3;
  });
  const wrongBrand = rows.filter((row) => boolish(row.wrong_brand_flag));

  const rate = (count, total) => total === 0 ? 'n/a' : `${((count / total) * 100).toFixed(1)}%`;
  const weightedScore = measured.reduce((sum, row) => sum + (numeric(row.excalicast_score) ?? 0), 0);

  return {
    expected,
    measured: measured.length,
    unmeasured: expected - measured.length,
    included: included.length,
    includedRate: rate(included.length, measured.length),
    top3: top3.length,
    top3Rate: rate(top3.length, measured.length),
    wrongBrand: wrongBrand.length,
    wrongBrandRate: rate(wrongBrand.length, measured.length),
    weightedVisibility: measured.length === 0 ? 'n/a' : `${((weightedScore / measured.length) * 100).toFixed(1)}%`,
  };
}

function printSummary(title, rows) {
  const s = summarize(rows);
  console.log(`\n${title}`);
  console.log(`  Expected checks:     ${s.expected}`);
  console.log(`  Measured checks:     ${s.measured}`);
  console.log(`  Unmeasured checks:   ${s.unmeasured}`);
  console.log(`  Included checks:     ${s.included} (${s.includedRate})`);
  console.log(`  Top-3 checks:        ${s.top3} (${s.top3Rate})`);
  console.log(`  Wrong-brand flags:   ${s.wrongBrand} (${s.wrongBrandRate})`);
  console.log(`  Weighted visibility: ${s.weightedVisibility}`);
}

if (!fs.existsSync(file)) {
  console.error(`Benchmark CSV not found: ${file}`);
  process.exit(1);
}

const rows = toObjects(parseCsv(fs.readFileSync(file, 'utf8')));
if (rows.length === 0) {
  console.error(`Benchmark CSV has no data rows: ${file}`);
  process.exit(1);
}

printSummary(`GEO benchmark summary: ${path.relative(process.cwd(), file)}`, rows);

for (const [platform, platformRows] of groupBy(rows, (row) => row.platform || '(missing platform)')) {
  printSummary(`By platform: ${platform}`, platformRows);
}

for (const [locale, localeRows] of groupBy(rows, (row) => row.locale || '(missing locale)')) {
  printSummary(`By locale: ${locale}`, localeRows);
}
