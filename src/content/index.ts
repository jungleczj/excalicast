import { COMPARE_ENTRIES } from './compare';
import { USE_CASE_ENTRIES } from './use-cases';
import { BLOG_ENTRIES } from './blog';
import { PILLAR_ENTRIES } from './pillars';

export * from './types';
export { COMPARE_ENTRIES, getCompareEntry } from './compare';
export { USE_CASE_ENTRIES, getUseCaseEntry } from './use-cases';
export { BLOG_ENTRIES, getBlogEntry } from './blog';
export { PILLAR_ENTRIES, getPillarEntry } from './pillars';

/** Every content route (path without locale prefix) + its lastModified date. */
export function allContentRoutes(): { path: string; lastModified: string }[] {
  return [
    { path: '/compare', lastModified: latest(COMPARE_ENTRIES.map((e) => e.updatedAt)) },
    { path: '/use-cases', lastModified: latest(USE_CASE_ENTRIES.map((e) => e.updatedAt)) },
    { path: '/blog', lastModified: latest(BLOG_ENTRIES.map((e) => e.updatedAt)) },
    ...PILLAR_ENTRIES.map((e) => ({ path: `/${e.slug}`, lastModified: e.updatedAt })),
    ...COMPARE_ENTRIES.map((e) => ({ path: `/compare/${e.slug}`, lastModified: e.updatedAt })),
    ...USE_CASE_ENTRIES.map((e) => ({ path: `/use-cases/${e.slug}`, lastModified: e.updatedAt })),
    ...BLOG_ENTRIES.map((e) => ({ path: `/blog/${e.slug}`, lastModified: e.updatedAt })),
  ];
}

function latest(dates: string[]): string {
  return dates.length ? dates.slice().sort().at(-1)! : '2026-06-01';
}
