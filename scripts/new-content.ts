/**
 * Scaffold a new programmatic-SEO content entry.
 *
 *   npx tsx scripts/new-content.ts compare <slug> "Competitor"
 *   npx tsx scripts/new-content.ts use-case <slug>
 *   npx tsx scripts/new-content.ts blog <slug>
 *
 * Prints a ready-to-paste TypeScript object for the matching file in
 * src/content/. Add a long-tail landing page = run this + fill the bilingual
 * fields (or hand the skeleton to an AI with the GEO writing rules in
 * docs/marketing-cold-start.md). No route code to touch — the [slug] templates
 * and sitemap.ts pick it up automatically.
 */

const [, , kind, slug, competitor] = process.argv;
const today = new Date().toISOString().slice(0, 10);

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!kind || !slug) {
  bail('Usage: new-content.ts <compare|use-case|blog> <slug> ["Competitor"]');
}

const L = (en = '', zh = '') => `{ en: ${JSON.stringify(en)}, zh: ${JSON.stringify(zh)} }`;

if (kind === 'compare') {
  if (!competitor) bail('compare needs a competitor name: new-content.ts compare <slug> "Loom"');
  console.log(`
// → append to COMPARE_ENTRIES in src/content/compare.ts
{
  slug: ${JSON.stringify(slug)},
  competitor: ${JSON.stringify(competitor)},
  title: ${L(`Excalicast vs ${competitor}: …`, `Excalicast vs ${competitor}：…`)},
  description: ${L()},
  intro: ${L()}, // GEO one-liner: a self-contained factual definition
  rows: [
    { feature: ${L()}, excalicast: ${L()}, competitor: ${L()} },
  ],
  verdict: ${L()},
  faqs: [
    { q: ${L()}, a: ${L()} },
  ],
  updatedAt: ${JSON.stringify(today)},
},`);
} else if (kind === 'use-case') {
  console.log(`
// → append to USE_CASE_ENTRIES in src/content/use-cases.ts
{
  slug: ${JSON.stringify(slug)},
  title: ${L()},
  description: ${L()},
  intro: ${L()}, // GEO one-liner
  steps: [
    { title: ${L()}, body: ${L()} },
  ],
  faqs: [
    { q: ${L()}, a: ${L()} },
  ],
  updatedAt: ${JSON.stringify(today)},
},`);
} else if (kind === 'blog') {
  console.log(`
// → append to BLOG_ENTRIES in src/content/blog.ts
{
  slug: ${JSON.stringify(slug)},
  title: ${L()},
  description: ${L()},
  date: ${JSON.stringify(today)},
  intro: ${L()}, // GEO one-liner
  body: [
    { heading: ${L()}, paragraphs: [${L()}] },
  ],
  faqs: [
    { q: ${L()}, a: ${L()} },
  ],
},`);
} else {
  bail(`Unknown kind "${kind}". Use compare | use-case | blog.`);
}
