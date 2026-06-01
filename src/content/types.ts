/**
 * Content data model for the programmatic SEO/GEO engine.
 *
 * Everything is plain typed data (no CMS, no MDX toolchain) so it ships with
 * the repo, renders fully on the server, and is trivially enumerable by
 * sitemap.ts. Each entry is bilingual; the page templates pick the field by
 * locale. To add a long-tail landing page you add one object — no route code.
 */

export type Locale = 'zh' | 'en';

/** A string available in both supported locales. */
export type LocalizedText = { zh: string; en: string };

export interface FaqItem {
  q: LocalizedText;
  a: LocalizedText;
}

/** A cross-link to another content page (for internal-linking / hub-and-spoke). */
export type ContentType = 'compare' | 'use-case' | 'blog';
export interface ContentRef {
  type: ContentType;
  slug: string;
}

/** Comparison / "alternative to" landing page (e.g. Excalicast vs Loom). */
export interface CompareEntry {
  slug: string;
  /** Competitor display name, e.g. "Loom". */
  competitor: string;
  title: LocalizedText;
  /** Meta description (≤ ~160 chars). */
  description: LocalizedText;
  /** GEO one-liner: a self-contained factual definition AI engines can lift. */
  intro: LocalizedText;
  /** Comparison table rows. */
  rows: { feature: LocalizedText; excalicast: LocalizedText; competitor: LocalizedText }[];
  /** Prose verdict paragraph. */
  verdict: LocalizedText;
  faqs: FaqItem[];
  /** Cross-links to related content pages (internal linking). */
  related?: ContentRef[];
  /** ISO date (YYYY-MM-DD) — feeds sitemap lastModified. */
  updatedAt: string;
}

/** Use-case / scenario landing page (e.g. "record a whiteboard lecture"). */
export interface UseCaseEntry {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  intro: LocalizedText;
  steps: { title: LocalizedText; body: LocalizedText }[];
  faqs: FaqItem[];
  related?: ContentRef[];
  updatedAt: string;
}

/** A blog block: optional heading + paragraphs (kept structured, no MDX dep). */
export interface BlogBlock {
  heading?: LocalizedText;
  paragraphs: LocalizedText[];
}

export interface BlogEntry {
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Short standfirst shown under the title and used as GEO definition. */
  intro: LocalizedText;
  body: BlogBlock[];
  faqs?: FaqItem[];
  related?: ContentRef[];
}

export function pick(text: LocalizedText, locale: string): string {
  return locale === 'zh' ? text.zh : text.en;
}
