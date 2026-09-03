import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BLOG_ENTRIES, type BlogEntry, type LocalizedText } from '@/content';

const KEYWORD_EXPANSION_PATH = path.join(
  process.cwd(),
  'docs/seo/keyword-expansion-2026-09-02.csv',
);
const CONTENT_CLUSTER_MAP_PATH = path.join(
  process.cwd(),
  'docs/seo/content-cluster-map-2026-09-02.csv',
);

const CORE_BLOG_SLUGS = [
  'how-to-screen-record-on-windows-11',
  'screencasting-guide',
  'best-screen-recorder-for-mac',
  'whiteboard-animation-and-hand-drawn-explainers',
  'whiteboard-animation-software-comparison',
] as const;

type StructuredBlogBlock = BlogEntry['body'][number] & {
  kind?: string;
  media?: Array<{
    alt?: LocalizedText;
    caption?: LocalizedText;
  }>;
  table?: {
    caption?: LocalizedText;
    columns?: LocalizedText[];
    rows?: LocalizedText[][];
  };
  callout?: {
    tone?: 'answer' | 'tip' | 'warning' | 'reality-check';
    title?: LocalizedText;
    body?: LocalizedText;
  };
  checklist?: LocalizedText[];
  example?: LocalizedText[];
  codeExample?: LocalizedText[];
};

type StructuredBlogEntry = BlogEntry & {
  body: StructuredBlogBlock[];
  limitations?: LocalizedText[];
};

type CsvRow = Record<string, string>;

test('qualified keyword research maps at least 50 terms to one primary page', () => {
  const keywords = readCsv(KEYWORD_EXPANSION_PATH);
  const mappings = readCsv(CONTENT_CLUSTER_MAP_PATH);

  expect(keywords.length).toBeGreaterThanOrEqual(50);
  expect(new Set(mappings.map((row) => row.keyword)).size).toBe(mappings.length);
  expect(
    new Set(
      mappings
        .filter((row) => row.is_primary === 'true')
        .map((row) => row.target_slug),
    ).size,
  ).toBeGreaterThanOrEqual(15);
});

test.describe('Top3 core article quality contracts', () => {
  for (const slug of CORE_BLOG_SLUGS) {
    test(`${slug} meets the Top3 editorial depth contract`, () => {
      const metrics = analyzeEntry(getBlogEntry(slug));

      expect(metrics.totalWords, `${slug} English total word count`).toBeGreaterThanOrEqual(1400);
      expect(metrics.totalWords, `${slug} English total word count`).toBeLessThanOrEqual(2200);
      expect(metrics.titleLength, `${slug} English title length`).toBeGreaterThanOrEqual(45);
      expect(metrics.titleLength, `${slug} English title length`).toBeLessThanOrEqual(58);
      expect(metrics.leadWords, `${slug} English lead word count`).toBeGreaterThanOrEqual(40);
      expect(metrics.leadWords, `${slug} English lead word count`).toBeLessThanOrEqual(70);
      expect(metrics.h2Count, `${slug} body H2 count`).toBeGreaterThanOrEqual(5);
      expect(metrics.h2Count, `${slug} body H2 count`).toBeLessThanOrEqual(8);
      expect(metrics.faqCount, `${slug} FAQ count`).toBeGreaterThanOrEqual(3);
      expect(metrics.sourceCount, `${slug} source count`).toBeGreaterThanOrEqual(3);
    });
  }

  test('Top3 core articles keep English body paragraphs within the short-paragraph ceiling', () => {
    for (const slug of CORE_BLOG_SLUGS) {
      const entry = getBlogEntry(slug);
      for (const paragraph of getParagraphAudits(entry)) {
        expect(
          paragraph.text.length,
          `${slug} ${paragraph.label} exceeds the 240-character paragraph ceiling`,
        ).toBeLessThanOrEqual(240);
      }
    }
  });

  test('Top3 core articles include visual proof, a decision aid, and a reality-check block', () => {
    for (const slug of CORE_BLOG_SLUGS) {
      const metrics = analyzeEntry(getBlogEntry(slug));

      expect(metrics.mediaCount, `${slug} visual evidence block count`).toBeGreaterThanOrEqual(2);
      expect(metrics.decisionAidCount, `${slug} decision aid count`).toBeGreaterThanOrEqual(1);
      expect(metrics.realityCheckCount, `${slug} limitation or reality-check block count`).toBeGreaterThanOrEqual(1);
    }
  });
});

function getBlogEntry(slug: (typeof CORE_BLOG_SLUGS)[number]): StructuredBlogEntry {
  const entry = BLOG_ENTRIES.find((item) => item.slug === slug) as StructuredBlogEntry | undefined;
  expect(entry, `${slug} must exist in BLOG_ENTRIES`).toBeTruthy();
  return entry!;
}

function analyzeEntry(entry: StructuredBlogEntry) {
  const bodyBlocks = entry.body ?? [];
  const structuredText = bodyBlocks.flatMap((block) => collectStructuredEnglish(block));
  const englishText = [
    entry.title.en,
    entry.description.en,
    entry.intro.en,
    ...bodyBlocks.flatMap((block) => [
      block.heading?.en ?? '',
      ...block.paragraphs.map((paragraph) => paragraph.en),
    ]),
    ...(entry.faqs ?? []).flatMap((faq) => [faq.q.en, faq.a.en]),
    ...(entry.limitations ?? []).map((item) => item.en),
    ...structuredText,
  ].filter(Boolean);

  const mediaCount =
    (entry.heroMedia ? 1 : 0)
    + bodyBlocks.reduce((count, block) => count + (block.media?.length ?? 0), 0);

  const decisionAidCount = bodyBlocks.reduce((count, block) => {
    if (block.table) return count + 1;
    if ((block.checklist?.length ?? 0) > 0) return count + 1;
    return count;
  }, 0);

  const realityCheckCount =
    bodyBlocks.reduce((count, block) => (
      block.callout?.tone === 'reality-check' ? count + 1 : count
    ), 0)
    + ((entry.limitations?.length ?? 0) > 0 ? 1 : 0);

  return {
    titleLength: entry.title.en.length,
    leadWords: countWords(entry.intro.en),
    totalWords: countWords(englishText.join(' ')),
    h2Count: bodyBlocks.filter((block) => Boolean(block.heading?.en.trim())).length,
    faqCount: entry.faqs?.length ?? 0,
    sourceCount: entry.sources.length,
    mediaCount,
    decisionAidCount,
    realityCheckCount,
  };
}

function getParagraphAudits(entry: StructuredBlogEntry) {
  return entry.body.flatMap((block, blockIndex) => {
    if (isParagraphLengthExempt(block)) return [];

    return block.paragraphs.map((paragraph, paragraphIndex) => ({
      label: `${block.heading?.en ?? `block ${blockIndex + 1}`} paragraph ${paragraphIndex + 1}`,
      text: paragraph.en,
    }));
  });
}

function isParagraphLengthExempt(block: StructuredBlogBlock) {
  const kind = block.kind?.toLowerCase() ?? '';
  return Boolean(
    block.table
    || (block.checklist?.length ?? 0) > 0
    || kind.includes('example')
    || kind.includes('code'),
  );
}

function collectStructuredEnglish(block: StructuredBlogBlock): string[] {
  return [
    ...(block.media ?? []).flatMap((item) => [item.alt?.en ?? '', item.caption?.en ?? '']),
    ...(block.table
      ? [
          block.table.caption?.en ?? '',
          ...(block.table.columns ?? []).map((column) => column.en),
          ...(block.table.rows ?? []).flatMap((row) => row.map((cell) => cell.en)),
        ]
      : []),
    ...(block.callout ? [block.callout.title?.en ?? '', block.callout.body?.en ?? ''] : []),
    ...(block.checklist ?? []).map((item) => item.en),
    ...(block.example ?? []).map((item) => item.en),
    ...(block.codeExample ?? []).map((item) => item.en),
  ].filter(Boolean);
}

function countWords(value: string): number {
  return value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
}

function readCsv(filePath: string): CsvRow[] {
  const [headerRow, ...rows] = parseCsv(readFileSync(filePath, 'utf8'));
  const headers = headerRow ?? [];
  return rows
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}
