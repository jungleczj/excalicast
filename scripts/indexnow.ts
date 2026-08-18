/**
 * IndexNow submitter — instantly notify Bing / Yandex / Seznam / Naver of our
 * URLs so a brand-new site gets crawled far sooner than waiting for organic
 * discovery. (Google does not officially consume IndexNow; for Google use
 * Search Console "Request indexing" + backlinks.)
 *
 * Usage:
 *   npx tsx scripts/indexnow.ts            # submit all URLs
 *   npx tsx scripts/indexnow.ts --dry-run  # print the URL list, submit nothing
 *
 * Run after each production deploy or whenever content pages are added.
 *
 * The key file public/<KEY>.txt must be deployed and reachable at
 * https://excalicast.cc/<KEY>.txt (IndexNow verifies ownership via it).
 *
 * Kept dependency-free and alias-free (only imports the alias-free
 * src/content data layer) so it runs under plain `tsx`.
 */
import { allContentRoutes } from '../src/content/index';

// 站点规范域名（见 CLAUDE.md「域名约定」）。
const SITE_URL = 'https://excalicast.cc';
const HOST = 'excalicast.cc';
const LOCALES = ['zh', 'en'] as const;
const KEY = 'e0db09f0b1ee71fc3abbf04e5909381f';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Locale-prefixed marketing/legal paths (path '' = the locale landing page). */
const STATIC_PATHS = ['', '/pricing', '/terms', '/privacy', '/refund'];

function buildUrlList(): string[] {
  const paths = [...STATIC_PATHS, ...allContentRoutes().map((r) => r.path)];
  const urls = new Set<string>();
  for (const loc of LOCALES) {
    for (const p of paths) {
      urls.add(`${SITE_URL}/${loc}${p}`);
    }
  }
  return [...urls];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const urlList = buildUrlList();

  console.log(`IndexNow: ${urlList.length} URLs`);
  for (const u of urlList) console.log('  ' + u);

  if (dryRun) {
    console.log('\n--dry-run: nothing submitted.');
    return;
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `${SITE_URL}/${KEY}.txt`,
      urlList,
    }),
  });

  // IndexNow returns 200 (accepted) or 202 (accepted, validation pending).
  console.log(`\nIndexNow response: ${res.status} ${res.statusText}`);
  const text = await res.text().catch(() => '');
  if (text) console.log(text);
  if (![200, 202].includes(res.status)) {
    process.exitCode = 1;
    console.error('IndexNow submission failed. Common causes: key file not yet deployed/reachable, or rate limiting.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
