#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const RESULT_COLUMNS = [
  'date',
  'platform',
  'prompt_id',
  'locale',
  'prompt',
  'excalicast_score',
  'rank_position',
  'cited_url',
  'wrong_brand_flag',
  'competitors',
  'answer_excerpt',
  'content_gap',
  'notes',
];

const DEFAULT_PLATFORMS = [
  'ChatGPT Search',
  'Gemini',
  'Google AI Overview',
  'Perplexity',
];

const PLATFORM_ALIASES = new Map([
  ['chatgpt', 'ChatGPT Search'],
  ['chatgpt-search', 'ChatGPT Search'],
  ['openai', 'ChatGPT Search'],
  ['gemini', 'Gemini'],
  ['google', 'Google AI Overview'],
  ['google-ai', 'Google AI Overview'],
  ['google-ai-overview', 'Google AI Overview'],
  ['aio', 'Google AI Overview'],
  ['perplexity', 'Perplexity'],
]);

const COMPETITORS = [
  'Loom',
  'Screen Studio',
  'Descript',
  'Tella',
  'OBS',
  'Camtasia',
  'Snagit',
  'Canva',
  'Miro',
  'FigJam',
  'Explain Everything',
  'Microsoft Whiteboard',
  'Zoom',
  'VEED',
  'Kapwing',
  'Type Studio',
  'FocuSee',
  'ScreenPal',
  'Vidyard',
  'Excalidraw',
  'Excalicord',
  'Excalirec',
];

const CORE_PROMPTS = [
  {
    locale: 'en',
    cluster: 'excalidraw-recording',
    priority: 'p0',
    prompt: 'What is the best tool to record an Excalidraw whiteboard as a video with voice?',
  },
  {
    locale: 'en',
    cluster: 'no-screen-recording',
    priority: 'p0',
    prompt: 'How can I record an Excalidraw canvas without using screen recording?',
  },
  {
    locale: 'en',
    cluster: 'browser-recorder',
    priority: 'p0',
    prompt: 'Which browser-based whiteboard recorder can export MP4 with webcam and microphone?',
  },
  {
    locale: 'en',
    cluster: 'loom-alternative',
    priority: 'p1',
    prompt: 'What is a good Loom alternative for whiteboard explainer videos?',
  },
  {
    locale: 'en',
    cluster: 'multi-aspect-export',
    priority: 'p1',
    prompt: 'How do I turn one whiteboard recording into 16:9 and 9:16 videos?',
  },
  {
    locale: 'en',
    cluster: 'teacher-subtitles',
    priority: 'p1',
    prompt: 'Which whiteboard recorder is best for online teachers who need subtitles?',
  },
  {
    locale: 'en',
    cluster: 'architecture-walkthrough',
    priority: 'p1',
    prompt: 'What tool should a software architect use to record an async system-design walkthrough?',
  },
  {
    locale: 'en',
    cluster: 'math-tutorial',
    priority: 'p1',
    prompt: 'How can I record a math tutorial on a whiteboard and publish it to YouTube?',
  },
  {
    locale: 'en',
    cluster: 'local-first',
    priority: 'p0',
    prompt: 'What local-first whiteboard recording tool keeps recordings on my device?',
  },
  {
    locale: 'en',
    cluster: 'content-assets',
    priority: 'p0',
    prompt: 'Which tools can record a whiteboard and generate captions, outlines, and handouts?',
  },
  {
    locale: 'zh',
    cluster: 'excalidraw-recording',
    priority: 'p0',
    prompt: 'Excalidraw 怎么录制成视频并带上语音？',
  },
  {
    locale: 'zh',
    cluster: 'browser-recorder',
    priority: 'p0',
    prompt: '有没有在线白板录视频工具，能直接导出 MP4？',
  },
  {
    locale: 'zh',
    cluster: 'teacher-subtitles',
    priority: 'p1',
    prompt: '白板讲课录制后怎么自动生成字幕？',
  },
  {
    locale: 'zh',
    cluster: 'math-tutorial',
    priority: 'p1',
    prompt: '有什么适合录制数学讲题的白板录制工具？',
  },
  {
    locale: 'zh',
    cluster: 'multi-aspect-export',
    priority: 'p1',
    prompt: '如何把一次白板录制同时导出横屏和竖屏？',
  },
  {
    locale: 'zh',
    cluster: 'loom-alternative',
    priority: 'p1',
    prompt: 'Loom 有没有更适合白板讲解的替代工具？',
  },
  {
    locale: 'zh',
    cluster: 'capture-controls',
    priority: 'p1',
    prompt: '录制架构图讲解，怎么避免窗口遮挡被录进去？',
  },
  {
    locale: 'zh',
    cluster: 'full-workflow',
    priority: 'p0',
    prompt: '哪个工具可以在浏览器里录白板、剪辑、加字幕、再发布？',
  },
  {
    locale: 'zh',
    cluster: 'archive-search',
    priority: 'p0',
    prompt: '白板录制内容怎么归档成可以搜索的素材？',
  },
  {
    locale: 'zh',
    cluster: 'full-workflow',
    priority: 'p0',
    prompt: 'Excalidraw 白板讲解如何录制、剪辑并分发到多个平台？',
  },
];

function usage() {
  console.log(`
Usage:
  npm run geo:generate -- [options]
  npm run geo:run -- [options]
  npm run geo:analyze -- [options]

Commands:
  generate   Generate a dated benchmark CSV from core prompts + Search Console CSVs.
  run        Use Playwright to submit prompts to answer/search surfaces and fill scores.
  analyze    Summarize a filled benchmark CSV and write recommendations.

Generate options:
  --out <file>                  Output CSV. Default: docs/geo/benchmark-results-YYYY-MM-DD.csv
  --keyword-csv <file>          Search Console keyword export.
  --page-csv <file>             Search Console page traffic export.
  --core-only                   Use only the 20 canonical benchmark prompts.
  --platform <name|all>         Repeat rows for one platform or all platforms.

Run options:
  --input <file>                Benchmark CSV to fill.
  --out <file>                  Output CSV. Default: overwrite --input.
  --platform <name|all>         Platform to run: google, perplexity, chatgpt, gemini, all.
  --limit <n>                   Max rows to run.
  --prompt-id <id>              Run only one prompt id.
  --locale <en|zh>              Run only one locale.
  --headed                      Open a visible browser.
  --profile-dir <dir>           Persistent browser profile for logged-in surfaces.
  --channel <name>              Browser channel, e.g. chrome.
  --manual-login-ms <n>         Wait after browser launch so you can log in manually.
  --timeout-ms <n>              Per-prompt wait budget. Default: 45000.
  --delay-ms <n>                Delay between prompts. Default: 2500.
  --raw-dir <dir>               Store raw answers. Default: docs/geo/runs/YYYY-MM-DD-HHMMSS.
  --score-google-serp           If no AI Overview is detected, score visible Google snippets as a proxy.
  --allow-external              Required for live network runs.
  --dry-run                     Print rows that would run, without opening a browser.

Analyze options:
  --input <file>                Filled benchmark CSV.
  --out <file>                  Markdown report. Default: docs/geo/answer-benchmark-report-YYYY-MM-DD.md
`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return opts;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function ensureDir(fileOrDir, isDir = false) {
  const dir = isDir ? fileOrDir : path.dirname(fileOrDir);
  fs.mkdirSync(dir, { recursive: true });
}

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
  return rows.filter((r) => r.some((value) => String(value).trim() !== ''));
}

function toObjects(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  const normalizedHeader = header.map((h) => h.replace(/^\uFEFF/, '').trim());
  return body.map((cells) => Object.fromEntries(normalizedHeader.map((key, index) => [key, cells[index] ?? ''])));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function stringifyCsv(rows, columns = RESULT_COLUMNS) {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ].join('\n') + '\n';
}

function readCsvObjects(file) {
  return toObjects(parseCsv(fs.readFileSync(path.resolve(file), 'utf8')));
}

function numberish(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/%$/, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizePlatform(value) {
  if (!value || value === true || String(value).toLowerCase() === 'all') return 'all';
  return PLATFORM_ALIASES.get(String(value).trim().toLowerCase()) ?? String(value).trim();
}

function selectedPlatforms(value) {
  const normalized = normalizePlatform(value);
  if (normalized === 'all') return DEFAULT_PLATFORMS;
  return [normalized];
}

function uniqueByPrompt(prompts) {
  const seen = new Set();
  const out = [];
  for (const prompt of prompts) {
    const key = `${prompt.locale}:${prompt.prompt}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prompt);
  }
  return out;
}

function readKeywordPrompts(keywordCsv, pageCsv) {
  const prompts = [];
  let keywords = [];
  if (keywordCsv && fs.existsSync(path.resolve(keywordCsv))) {
    keywords = readCsvObjects(keywordCsv)
      .map((row) => ({
        keyword: row.Keyword ?? row.keyword ?? '',
        impressions: numberish(row.Impressions ?? row.impressions) ?? 0,
        clicks: numberish(row.Clicks ?? row.clicks) ?? 0,
        position: numberish(row['Avg. Position'] ?? row.position) ?? 99,
      }))
      .filter((row) => row.keyword)
      .sort((a, b) => (b.impressions - a.impressions) || (a.position - b.position));
  }

  const keywordText = keywords.map((row) => row.keyword.toLowerCase()).join('\n');
  const add = (prompt) => prompts.push(prompt);

  if (/excalicord|excalirec/.test(keywordText)) {
    add({
      locale: 'zh',
      cluster: 'brand-confusion',
      priority: 'p0',
      source_keywords: keywords.filter((row) => /excalicord|excalirec/i.test(row.keyword)).map((row) => row.keyword).join(' | '),
      prompt: 'excalicord 白板录屏是什么？和 Excalicast 有什么区别？',
    });
    add({
      locale: 'en',
      cluster: 'brand-confusion',
      priority: 'p0',
      source_keywords: keywords.filter((row) => /excalicord|excalirec/i.test(row.keyword)).map((row) => row.keyword).join(' | '),
      prompt: 'Is Excalicord the same as Excalicast for recording whiteboard videos?',
    });
  }

  if (/excalidraw.*录|excalidraw.*video|whiteboard.*record/.test(keywordText)) {
    add({
      locale: 'zh',
      cluster: 'excalidraw-recording',
      priority: 'p0',
      source_keywords: keywords.filter((row) => /excalidraw|whiteboard/i.test(row.keyword)).map((row) => row.keyword).slice(0, 5).join(' | '),
      prompt: 'Excalidraw 可以直接录制成带摄像头、麦克风和字幕的视频吗？',
    });
    add({
      locale: 'en',
      cluster: 'excalidraw-recording',
      priority: 'p0',
      source_keywords: keywords.filter((row) => /excalidraw|whiteboard/i.test(row.keyword)).map((row) => row.keyword).slice(0, 5).join(' | '),
      prompt: 'Can Excalidraw be recorded as a video with webcam, voice, and captions in the browser?',
    });
  }

  if (/白板录视频|屏幕录制 白板|whiteboard math/.test(keywordText)) {
    add({
      locale: 'zh',
      cluster: 'whiteboard-video-software',
      priority: 'p1',
      source_keywords: keywords.filter((row) => /白板|whiteboard/i.test(row.keyword)).map((row) => row.keyword).slice(0, 5).join(' | '),
      prompt: '有哪些白板录视频软件适合课程、数学讲题和架构图讲解？',
    });
    add({
      locale: 'en',
      cluster: 'math-tutorial',
      priority: 'p1',
      source_keywords: keywords.filter((row) => /math|whiteboard/i.test(row.keyword)).map((row) => row.keyword).slice(0, 5).join(' | '),
      prompt: 'What is the best workflow for recording a whiteboard math explanation and turning it into reusable teaching content?',
    });
  }

  if (/16.*9|抖音|竖屏|aspect/.test(keywordText)) {
    add({
      locale: 'zh',
      cluster: 'multi-aspect-export',
      priority: 'p1',
      source_keywords: keywords.filter((row) => /16|9|抖音|竖屏|aspect/i.test(row.keyword)).map((row) => row.keyword).join(' | '),
      prompt: '如何把白板讲解一次录制后导出 YouTube 横屏和抖音竖屏两个版本？',
    });
  }

  if (pageCsv && fs.existsSync(path.resolve(pageCsv))) {
    const pages = readCsvObjects(pageCsv).map((row) => String(row.Page ?? row.page ?? ''));
    if (pages.some((page) => /record-whiteboard-without-screen-recording/.test(page))) {
      add({
        locale: 'en',
        cluster: 'no-screen-recording',
        priority: 'p1',
        source_keywords: 'record-whiteboard-without-screen-recording page',
        prompt: 'How can I record a whiteboard explanation without capturing my whole screen or browser UI?',
      });
    }
    if (pages.some((page) => /one-recording-every-aspect-ratio/.test(page))) {
      add({
        locale: 'en',
        cluster: 'multi-aspect-export',
        priority: 'p1',
        source_keywords: 'one-recording-every-aspect-ratio page',
        prompt: 'Which tool can export one whiteboard recording into multiple aspect ratios for different platforms?',
      });
    }
  }

  return prompts;
}

function generateRows(opts) {
  const platforms = selectedPlatforms(opts.platform);
  const date = opts.date || today();
  const generatedPrompts = opts['core-only']
    ? CORE_PROMPTS
    : uniqueByPrompt([...CORE_PROMPTS, ...readKeywordPrompts(opts['keyword-csv'], opts['page-csv'])]);

  return platforms.flatMap((platform) => generatedPrompts.map((prompt, index) => ({
    date,
    platform,
    prompt_id: String(index + 1),
    locale: prompt.locale,
    prompt: prompt.prompt,
    excalicast_score: '',
    rank_position: '',
    cited_url: '',
    wrong_brand_flag: '',
    competitors: '',
    answer_excerpt: '',
    content_gap: '',
    notes: [
      prompt.cluster ? `cluster=${prompt.cluster}` : '',
      prompt.priority ? `priority=${prompt.priority}` : '',
      prompt.source_keywords ? `source_keywords=${prompt.source_keywords}` : '',
    ].filter(Boolean).join('; '),
  })));
}

function getRunRows(rows, opts) {
  const platforms = new Set(selectedPlatforms(opts.platform));
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => platforms.has(row.platform))
    .filter(({ row }) => !opts['prompt-id'] || String(row.prompt_id) === String(opts['prompt-id']))
    .filter(({ row }) => !opts.locale || row.locale === opts.locale)
    .filter(({ row }) => opts.rerun || row.excalicast_score === '')
    .slice(0, opts.limit ? Number(opts.limit) : undefined);
}

function compactText(text, max = 520) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function extractUrls(text) {
  return Array.from(new Set(String(text ?? '').match(/https?:\/\/[^\s)\]}>"]+/gi) ?? []));
}

function scoreAnswer({ answerText, links = [], notes = '' }, row) {
  const text = String(answerText ?? '');
  const normalized = text.toLowerCase();
  const urls = Array.from(new Set([...links, ...extractUrls(text)]));
  const citedUrl = urls.find((url) => /(^https?:\/\/)?([^/]+\.)?excalicast\.cc\b/i.test(url)) ?? '';
  const mentionsExcalicast = /\bexcalicast\b|excalicast\.cc/i.test(text);
  const wrongBrand = /\bexcalicord\b|\bexcalirec\b/i.test(text);
  const recommendationTerms = /recommend|best|good fit|use excalicast|try excalicast|suitable|适合|推荐|可以用|优先考虑|首选/i;
  const competitors = COMPETITORS
    .filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text))
    .filter((name) => !/^excalicast$/i.test(name))
    .join(' | ');
  const rankPosition = mentionsExcalicast ? estimateRank(text) : '';
  const score = mentionsExcalicast
    ? (citedUrl || recommendationTerms.test(text) || Number(rankPosition) === 1 ? '1' : '0.5')
    : '0';

  return {
    excalicast_score: score,
    rank_position: rankPosition,
    cited_url: citedUrl,
    wrong_brand_flag: wrongBrand && !mentionsExcalicast ? '1' : (wrongBrand ? '1' : ''),
    competitors,
    answer_excerpt: compactText(text),
    content_gap: inferContentGap(row.prompt, row.locale, mentionsExcalicast, competitors),
    notes: [row.notes, notes].filter(Boolean).join('; '),
  };
}

function cleanPreviousRunNotes(notes) {
  return String(notes ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^raw=/.test(part))
    .filter((part) => !/prompt box not found|login required|login, bot check|unmeasured=|Run error|bot\/captcha|captcha|scored from visible|No detectable AI Overview/i.test(part))
    .join('; ');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function estimateRank(text) {
  const productPositions = ['Excalicast', ...COMPETITORS]
    .map((name) => {
      const match = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').exec(text);
      return match ? { name, index: match.index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  const rank = productPositions.findIndex((entry) => /^Excalicast$/i.test(entry.name));
  return rank >= 0 ? String(rank + 1) : '';
}

function inferContentGap(prompt, locale, mentionsExcalicast, competitors) {
  const p = String(prompt).toLowerCase();
  const cn = locale === 'zh';
  if (!mentionsExcalicast) {
    if (/loom/.test(p)) return cn ? '需要更强的 Loom 替代品对比页与外部佐证。' : 'Need a stronger Loom alternative comparison page and external corroboration.';
    if (/subtitle|caption|字幕/.test(p)) return cn ? '需要突出白板录制后自动字幕/双语字幕/导出字幕的答案块。' : 'Need clearer answer blocks for automatic captions and subtitle export.';
    if (/aspect|16:9|9:16|竖屏|横屏|抖音|youtube/.test(p)) return cn ? '需要强化“一次录制，多比例导出”的页面标题、FAQ 与引用信号。' : 'Need stronger one-recording-to-many-aspect-ratios page titles, FAQ, and citations.';
    if (/archive|search|归档|搜索|资产/.test(p)) return cn ? '需要把“录制库=可搜索内容资产”写成可被 AI 抽取的事实块。' : 'Need extractable facts that the library is a searchable content-asset archive.';
    if (/excalicord|excalirec/.test(p)) return cn ? '需要品牌纠错页：Excalicast 才是 canonical name，解释常见误拼。' : 'Need a brand-confusion page clarifying Excalicast as the canonical name.';
    return cn ? '需要该问题的直接答案页/FAQ 和更多外部引用。' : 'Need a direct-answer page/FAQ and more external citations for this query.';
  }
  if (competitors && !/excalicast/i.test(competitors)) {
    return cn ? '已被提及；下一步是争取首位推荐和 cited URL。' : 'Mentioned; next step is earning first-position recommendation and cited URL.';
  }
  return '';
}

async function clickIfVisible(page, selectors, timeout = 1200) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) {
        await locator.click({ timeout });
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function collectLinks(page) {
  try {
    return await page.$$eval('a[href]', (anchors) => Array.from(new Set(anchors.map((a) => a.href).filter(Boolean))));
  } catch {
    return [];
  }
}

async function bodyText(page) {
  try {
    return await page.locator('body').innerText({ timeout: 5000 });
  } catch {
    return '';
  }
}

async function fillPromptBox(page, prompt, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 5000 })) {
        await locator.click({ timeout: 5000 });
        try {
          await locator.fill(prompt, { timeout: 5000 });
        } catch {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          await page.keyboard.insertText(prompt);
        }
        await page.keyboard.press('Enter');
        return true;
      }
    } catch {
      // Try the next selector.
    }
  }
  return false;
}

async function waitForTextToSettle(page, initialText, timeoutMs) {
  const started = Date.now();
  let lastText = initialText ?? '';
  let stableCount = 0;
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(1500);
    const current = await bodyText(page);
    if (current.length > Math.max(450, initialText.length + 180)) {
      if (Math.abs(current.length - lastText.length) < 40) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      if (stableCount >= 2) return current;
    }
    lastText = current;
  }
  return lastText;
}

async function queryGoogle(page, row, opts) {
  const hl = row.locale === 'zh' ? 'zh-CN' : 'en';
  await page.goto(`https://www.google.com/search?hl=${encodeURIComponent(hl)}`, { waitUntil: 'domcontentloaded', timeout: Number(opts['timeout-ms']) });
  await clickIfVisible(page, [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("全部接受")',
    'button:has-text("同意")',
    'button:has-text("Accept")',
  ]);
  const initial = await bodyText(page);
  const filled = await fillPromptBox(page, row.prompt, [
    'textarea[name="q"]',
    'input[name="q"]',
    'textarea[aria-label*="Search"]',
    'textarea',
  ]);
  if (!filled) {
    return { answerText: initial, links: await collectLinks(page), notes: 'Google search box not found; possible consent/captcha page.' };
  }
  await page.waitForLoadState('domcontentloaded', { timeout: Number(opts['timeout-ms']) }).catch(() => {});
  await page.waitForTimeout(3500);
  const text = await bodyText(page);
  const links = await collectLinks(page);
  const hasAiOverview = /AI Overview|AI 概览|AI 摘要|生成式 AI|Search Labs/i.test(text);
  const blocked = /unusual traffic|captcha|not a robot|我们的系统检测到/i.test(text);
  if (blocked) {
    return {
      answerText: text,
      links,
      unmeasured: true,
      notes: 'unmeasured=google_captcha. Google showed a bot/captcha page; do not count this row.',
    };
  }
  if (!hasAiOverview && !opts['score-google-serp']) {
    return {
      answerText: text,
      links,
      unmeasured: true,
      notes: 'unmeasured=no_google_ai_overview. No detectable AI Overview; rerun with --score-google-serp only for a public-search proxy score.',
    };
  }
  return {
    answerText: text,
    links,
    notes: [
      hasAiOverview ? 'Google AI Overview text detected.' : 'No detectable AI Overview; scored from visible Google results/snippets.',
      blocked ? 'Google may have shown a bot/captcha page.' : '',
    ].filter(Boolean).join(' '),
  };
}

async function queryPerplexity(page, row, opts) {
  await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: Number(opts['timeout-ms']) });
  await clickIfVisible(page, [
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
    'button:has-text("Only necessary")',
    'button:has-text("同意")',
  ]);
  const initial = await bodyText(page);
  const filled = await fillPromptBox(page, row.prompt, [
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="anything"]',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
  ]);
  if (!filled) {
    return { answerText: initial, links: await collectLinks(page), notes: 'Perplexity prompt box not found; login, bot check, or UI change may be required.' };
  }
  await clickIfVisible(page, [
    'button:has-text("Allow all")',
    'button:has-text("Only necessary")',
    'button:has-text("Accept")',
  ], 800);
  let text = await waitForTextToSettle(page, initial, Number(opts['timeout-ms']));
  for (let i = 0; i < 3 && /\bThinking\b/i.test(text); i += 1) {
    await page.waitForTimeout(4000);
    text = await bodyText(page);
  }
  if (/\bThinking\b/i.test(text) || /Cookie Policy[\s\S]*Allow all[\s\S]*Only necessary/i.test(text)) {
    return {
      answerText: text,
      links: await collectLinks(page),
      unmeasured: true,
      notes: 'unmeasured=perplexity_pending_or_blocked. Perplexity did not expose a completed answer in this run.',
    };
  }
  return { answerText: text, links: await collectLinks(page), notes: '' };
}

async function queryChatGpt(page, row, opts) {
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: Number(opts['timeout-ms']) });
  const initial = await bodyText(page);
  if (/log in|sign up|登录|注册/i.test(initial) && !/message chatgpt|ask anything|prompt/i.test(initial)) {
    return { answerText: initial, links: await collectLinks(page), notes: 'Login required. Re-run with --headed --profile-dir after logging in.' };
  }
  const filled = await fillPromptBox(page, row.prompt, [
    '#prompt-textarea',
    'textarea[data-testid="prompt-textarea"]',
    'div[contenteditable="true"]',
    'textarea',
    '[role="textbox"]',
  ]);
  if (!filled) {
    return { answerText: initial, links: await collectLinks(page), notes: 'ChatGPT prompt box not found; login or UI change may be required.' };
  }
  const text = await waitForTextToSettle(page, initial, Number(opts['timeout-ms']));
  let articleText = '';
  try {
    articleText = await page.locator('article').last().innerText({ timeout: 3000 });
  } catch {
    articleText = text;
  }
  return { answerText: articleText || text, links: await collectLinks(page), notes: '' };
}

async function queryGemini(page, row, opts) {
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: Number(opts['timeout-ms']) });
  const initial = await bodyText(page);
  if (/sign in|登录|try gemini|use your google account/i.test(initial) && !/enter a prompt|ask gemini|输入提示/i.test(initial)) {
    return { answerText: initial, links: await collectLinks(page), notes: 'Login required. Re-run with --headed --profile-dir after logging in.' };
  }
  const filled = await fillPromptBox(page, row.prompt, [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
    '[role="textbox"]',
  ]);
  if (!filled) {
    return { answerText: initial, links: await collectLinks(page), notes: 'Gemini prompt box not found; login or UI change may be required.' };
  }
  const text = await waitForTextToSettle(page, initial, Number(opts['timeout-ms']));
  return { answerText: text, links: await collectLinks(page), notes: '' };
}

async function queryPlatform(context, row, opts) {
  const page = await context.newPage();
  page.setDefaultTimeout(Number(opts['timeout-ms']));
  try {
    if (row.platform === 'Google AI Overview') return await queryGoogle(page, row, opts);
    if (row.platform === 'Perplexity') return await queryPerplexity(page, row, opts);
    if (row.platform === 'ChatGPT Search') return await queryChatGpt(page, row, opts);
    if (row.platform === 'Gemini') return await queryGemini(page, row, opts);
    return { answerText: '', links: [], notes: `Unsupported platform: ${row.platform}` };
  } catch (error) {
    const text = await bodyText(page);
    return {
      answerText: text,
      links: await collectLinks(page),
      unmeasured: true,
      notes: `Run error: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function writeRawAnswer(rawDir, row, answerText) {
  ensureDir(rawDir, true);
  const safePlatform = row.platform.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = path.join(rawDir, `${String(row.prompt_id).padStart(2, '0')}-${row.locale}-${safePlatform}.txt`);
  fs.writeFileSync(file, String(answerText ?? ''));
  return file;
}

function summarize(rows) {
  const measured = rows.filter((row) => row.excalicast_score !== '');
  const included = measured.filter((row) => Number(row.excalicast_score) > 0);
  const recommended = measured.filter((row) => Number(row.excalicast_score) >= 1);
  const top3 = measured.filter((row) => {
    const rank = Number(row.rank_position);
    return Number.isFinite(rank) && rank >= 1 && rank <= 3;
  });
  const wrongBrand = measured.filter((row) => String(row.wrong_brand_flag).trim() !== '');
  const scoreSum = measured.reduce((sum, row) => sum + Number(row.excalicast_score || 0), 0);
  const pct = (n, d) => d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
  return {
    expected: rows.length,
    measured: measured.length,
    included: included.length,
    recommended: recommended.length,
    top3: top3.length,
    wrongBrand: wrongBrand.length,
    inclusionRate: pct(included.length, measured.length),
    recommendationRate: pct(recommended.length, measured.length),
    top3Rate: pct(top3.length, measured.length),
    wrongBrandRate: pct(wrongBrand.length, measured.length),
    weightedVisibility: measured.length ? `${((scoreSum / measured.length) * 100).toFixed(1)}%` : 'n/a',
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = map.get(key) ?? [];
    bucket.push(row);
    map.set(key, bucket);
  }
  return map;
}

function markdownTable(rows) {
  const header = '| Segment | Measured | Included | Recommended | Top-3 | Wrong brand | Weighted visibility |';
  const sep = '|---|---:|---:|---:|---:|---:|---:|';
  const body = rows.map(([label, summary]) => `| ${label} | ${summary.measured} | ${summary.included} (${summary.inclusionRate}) | ${summary.recommended} (${summary.recommendationRate}) | ${summary.top3} (${summary.top3Rate}) | ${summary.wrongBrand} (${summary.wrongBrandRate}) | ${summary.weightedVisibility} |`);
  return [header, sep, ...body].join('\n');
}

function recommendations(rows) {
  const measured = rows.filter((row) => row.excalicast_score !== '');
  const absent = measured.filter((row) => Number(row.excalicast_score) === 0);
  const mentionedNotCited = measured.filter((row) => Number(row.excalicast_score) > 0 && !row.cited_url);
  const wrongBrand = measured.filter((row) => row.wrong_brand_flag);
  const gaps = Array.from(new Set(absent.map((row) => row.content_gap).filter(Boolean))).slice(0, 8);
  const competitorCounts = new Map();
  for (const row of measured) {
    for (const competitor of String(row.competitors ?? '').split('|').map((x) => x.trim()).filter(Boolean)) {
      competitorCounts.set(competitor, (competitorCounts.get(competitor) ?? 0) + 1);
    }
  }
  const topCompetitors = Array.from(competitorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const out = [];
  if (wrongBrand.length > 0) {
    out.push('- P0：补品牌纠错与一致性信号。AI 回答里出现 Excalicord/Excalirec 混淆时，要用首页、FAQ、llms.txt、目录页和外部资料统一说明 canonical name 是 Excalicast。');
  }
  if (absent.length > 0) {
    out.push('- P0：为未上榜 query 做“直接答案块”。每个高频问题页顶部用 40–70 字直接回答：谁适合、能做什么、输出什么、是否本地优先。');
  }
  if (mentionedNotCited.length > 0) {
    out.push('- P1：已被提到但没引用 URL 的问题，需要加强可引用资产：FAQPage JSON-LD、HowTo、清晰 h2、公开 demo、Product Hunt/GitHub/目录站佐证。');
  }
  if (topCompetitors.length > 0) {
    out.push(`- P1：补公平对比页。当前共现竞品最高的是 ${topCompetitors.map(([name, count]) => `${name}(${count})`).join('、')}，优先做 “Excalicast vs …” 与 “best alternative for …”。`);
  }
  for (const gap of gaps) {
    out.push(`- Query gap：${gap}`);
  }
  return out.join('\n');
}

function analyzeRows(rows, inputFile) {
  const overall = summarize(rows);
  const byPlatform = Array.from(groupBy(rows, (row) => row.platform || '(missing platform)').entries())
    .map(([label, bucket]) => [label, summarize(bucket)]);
  const byLocale = Array.from(groupBy(rows, (row) => row.locale || '(missing locale)').entries())
    .map(([label, bucket]) => [label, summarize(bucket)]);

  return `# Excalicast GEO Answer Benchmark Report — ${today()}

Input: \`${inputFile}\`

## Overall

${markdownTable([['All measured rows', overall]])}

## By platform

${markdownTable(byPlatform)}

## By locale

${markdownTable(byLocale)}

## Recommended actions

${recommendations(rows) || '- No measured rows yet. Run Playwright collection first.'}

## Method

- Score 1.0: Excalicast is recommended or cited with the correct name / URL.
- Score 0.5: Excalicast is mentioned but not clearly recommended or cited.
- Score 0: Excalicast is absent.
- Wrong-brand flag: the answer mentions likely confusions such as Excalicord / Excalirec.
- Playwright collection stores raw answer text separately so the score can be audited.
`;
}

async function commandGenerate(opts) {
  const out = opts.out || `docs/geo/benchmark-results-${today()}.csv`;
  const rows = generateRows(opts);
  ensureDir(out);
  fs.writeFileSync(out, stringifyCsv(rows));
  console.log(`Generated ${rows.length} benchmark rows: ${out}`);
  console.log(`Prompts: ${new Set(rows.map((row) => `${row.locale}:${row.prompt}`)).size}; platforms: ${Array.from(new Set(rows.map((row) => row.platform))).join(', ')}`);
}

async function commandRun(opts) {
  if (!opts.input) {
    throw new Error('Missing --input <benchmark.csv>');
  }
  const input = path.resolve(opts.input);
  const out = path.resolve(opts.out || opts.input);
  const allowExternal = opts['allow-external'] || process.env.GEO_BENCHMARK_ALLOW_EXTERNAL === '1';
  const rawDir = opts['raw-dir'] || `docs/geo/runs/${timestamp()}`;
  const rows = readCsvObjects(input);
  const runRows = getRunRows(rows, opts);

  if (runRows.length === 0) {
    console.log('No matching unmeasured rows to run.');
    return;
  }
  if (opts['dry-run']) {
    for (const { row } of runRows) {
      console.log(`[dry-run] ${row.platform} #${row.prompt_id} ${row.locale}: ${row.prompt}`);
    }
    return;
  }
  if (!allowExternal) {
    throw new Error('Live network collection requires --allow-external or GEO_BENCHMARK_ALLOW_EXTERNAL=1.');
  }

  const timeoutMs = Number(opts['timeout-ms'] ?? 45000);
  const delayMs = Number(opts['delay-ms'] ?? 2500);
  const profileDir = path.resolve(opts['profile-dir'] || path.join(os.tmpdir(), 'excalicast-geo-playwright-profile'));
  ensureDir(profileDir, true);
  ensureDir(out);
  ensureDir(rawDir, true);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !opts.headed,
    channel: opts.channel === true ? undefined : opts.channel,
    viewport: { width: 1440, height: 960 },
    locale: opts.locale === 'zh' ? 'zh-CN' : 'en-US',
  });
  if (opts['manual-login-ms']) {
    const waitMs = Number(opts['manual-login-ms']);
    console.log(`Waiting ${waitMs}ms for manual login / security verification...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  try {
    for (const { row, index } of runRows) {
      console.log(`→ ${row.platform} #${row.prompt_id} ${row.locale}: ${row.prompt}`);
      const baseRow = { ...row, notes: cleanPreviousRunNotes(row.notes) };
      const raw = await queryPlatform(context, baseRow, { ...opts, 'timeout-ms': timeoutMs });
      const rawFile = writeRawAnswer(rawDir, row, raw.answerText);
      const scored = raw.unmeasured || (raw.notes && /login required|prompt box not found|unsupported platform|unmeasured=|captcha|bot check/i.test(raw.notes))
        ? {
            excalicast_score: '',
            rank_position: '',
            cited_url: '',
            wrong_brand_flag: '',
            competitors: '',
            answer_excerpt: compactText(raw.answerText),
            content_gap: '',
            notes: [baseRow.notes, raw.notes, `raw=${rawFile}`].filter(Boolean).join('; '),
          }
        : scoreAnswer(raw, baseRow);
      rows[index] = {
        ...row,
        ...scored,
        notes: [scored.notes, scored.notes.includes(rawFile) ? '' : `raw=${rawFile}`].filter(Boolean).join('; '),
      };
      fs.writeFileSync(out, stringifyCsv(rows));
      console.log(`  score=${rows[index].excalicast_score || 'unmeasured'} rank=${rows[index].rank_position || '-'} cited=${rows[index].cited_url || '-'} raw=${rawFile}`);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } finally {
    await context.close().catch(() => {});
  }

  console.log(`Updated benchmark CSV: ${out}`);
  console.log(`Raw answers: ${rawDir}`);
}

async function commandAnalyze(opts) {
  if (!opts.input) {
    throw new Error('Missing --input <benchmark.csv>');
  }
  const rows = readCsvObjects(opts.input);
  const out = opts.out || `docs/geo/answer-benchmark-report-${today()}.md`;
  ensureDir(out);
  fs.writeFileSync(out, analyzeRows(rows, opts.input));
  console.log(`Wrote report: ${out}`);
}

async function main() {
  const [command = 'help', ...argv] = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (command === 'help' || opts.help) {
    usage();
    return;
  }
  if (command === 'generate') return commandGenerate(opts);
  if (command === 'run') return commandRun(opts);
  if (command === 'analyze') return commandAnalyze(opts);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
