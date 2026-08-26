import { SITE_URL } from './alternates';

/**
 * schema.org builders. Centralised so landing + programmatic content pages
 * emit consistent structured data — the primary lever for GEO (getting
 * ChatGPT / Perplexity / Google AI Overview to cite excalicast.cc).
 */

export interface ProductSchemaInput {
  locale: string;
  /** Localised one-line description (reuse landing.meta.description). */
  description: string;
  /** Prices in major currency units, e.g. 4.99. */
  oneTimePrice: number;
  proPrice: number;
  maxPrice: number;
  currency: string; // ISO 4217, e.g. 'USD'
}

/** SoftwareApplication — the canonical "what is this product" fact block. */
export function softwareApplicationSchema(input: ProductSchemaInput): Record<string, unknown> {
  const { locale, description, oneTimePrice, proPrice, maxPrice, currency } = input;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: 'Excalicast',
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Screen & Whiteboard Recorder',
    operatingSystem: 'Web Browser (Chrome, Edge)',
    url: `${SITE_URL}/${locale}`,
    description,
    inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
    isAccessibleForFree: true,
    featureList: [
      'Records whiteboard operations as an editable event stream for the whiteboard source',
      'Captures a browser tab, app window, or desktop when a screen source is selected',
      'Exports one recording to landscape, portrait, square, feed, and custom dimensions',
      'Browser timeline with trim, split, delete, and editable Autozoom focus regions',
      'Local-first recording and rendering with explicit opt-in cloud features',
      'Captions and structured handouts on eligible plans',
    ],
    offers: [
      {
        '@type': 'Offer',
        name: 'One-time watermark-free export',
        price: oneTimePrice.toFixed(2),
        priceCurrency: currency,
        category: 'one-time',
      },
      {
        '@type': 'Offer',
        name: 'Pro (monthly)',
        price: proPrice.toFixed(2),
        priceCurrency: currency,
        category: 'subscription',
      },
      {
        '@type': 'Offer',
        name: 'Max (monthly)',
        price: maxPrice.toFixed(2),
        priceCurrency: currency,
        category: 'subscription',
      },
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
    isPartOf: { '@id': `${SITE_URL}/#website` },
  };
}

/** Organization — brand entity. */
export function organizationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Excalicast',
    url: SITE_URL,
    logo: `${SITE_URL}/icon.png`,
    description:
      'Excalicast is a browser-based workflow for multi-source recording, online editing, assisted cuts, editable Autozoom, captions, handouts, and publish-ready video exports.',
  };
}

/** WebSite entity without SearchAction: the public site has no site search. */
export function websiteSchema(_locale = 'en'): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'Excalicast',
    url: SITE_URL,
    inLanguage: ['en', 'zh-CN'],
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

function withoutContext(schema: Record<string, unknown>): Record<string, unknown> {
  const { ['@context']: _context, ...node } = schema;
  return node;
}

/** Connected brand graph used on the homepage and reusable by entity pages. */
export function brandGraphSchema(input: ProductSchemaInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      withoutContext(organizationSchema()),
      withoutContext(websiteSchema(input.locale)),
      withoutContext(softwareApplicationSchema(input)),
    ],
  };
}

export function aboutPageSchema(input: {
  locale: string;
  name: string;
  description: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${SITE_URL}/${input.locale}/about#page`,
    url: `${SITE_URL}/${input.locale}/about`,
    name: input.name,
    description: input.description,
    inLanguage: input.locale === 'zh' ? 'zh-CN' : 'en',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: [
      { '@id': `${SITE_URL}/#organization` },
      { '@id': `${SITE_URL}/#software` },
    ],
  };
}

export function blogPostingSchema(input: {
  locale: string;
  slug: string;
  headline: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  image: string;
  author: { name: string; url: string };
}): Record<string, unknown> {
  const url = `${SITE_URL}/${input.locale}/blog/${input.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: input.headline,
    description: input.description,
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    image: input.image,
    inLanguage: input.locale === 'zh' ? 'zh-CN' : 'en',
    author: {
      '@type': 'Organization',
      name: input.author.name,
      url: input.author.url,
    },
    publisher: { '@id': `${SITE_URL}/#organization` },
    isPartOf: { '@id': `${SITE_URL}/#website` },
    mainEntityOfPage: url,
  };
}

/** Emit only when the corresponding video is visibly embedded on the page. */
export function videoObjectSchema(input: {
  locale: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: string;
  contentUrl?: string;
  embedUrl?: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: input.name,
    description: input.description,
    thumbnailUrl: input.thumbnailUrl,
    uploadDate: input.uploadDate,
    inLanguage: input.locale === 'zh' ? 'zh-CN' : 'en',
    ...(input.contentUrl ? { contentUrl: input.contentUrl } : {}),
    ...(input.embedUrl ? { embedUrl: input.embedUrl } : {}),
  };
}

/** FAQPage — each Q/A becomes an answer candidate AI engines can lift verbatim. */
export function faqPageSchema(
  faqs: { question: string; answer: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/** BreadcrumbList — helps crawlers understand site hierarchy. */
export function breadcrumbSchema(
  items: { name: string; url: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}
