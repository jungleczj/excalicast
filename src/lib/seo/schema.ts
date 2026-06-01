import { SITE_URL } from './alternates';

/**
 * schema.org builders. Centralised so landing + programmatic content pages
 * emit consistent structured data — the primary lever for GEO (getting
 * ChatGPT / Perplexity / Google AI Overview to cite excalicast.cc).
 */

interface ProductSchemaInput {
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
    name: 'Excalicast',
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Screen & Whiteboard Recorder',
    operatingSystem: 'Web Browser (Chrome, Edge)',
    url: `${SITE_URL}/${locale}`,
    description,
    inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
    isAccessibleForFree: true,
    featureList: [
      'Records the whiteboard operation stream instead of screen pixels (immune to window occlusion / minimization)',
      'One recording exports to 16:9, 9:16, 1:1, and 4:5 aspect ratios without re-recording',
      'In-browser MP4 rendering via ffmpeg.wasm — raw recordings never leave the device',
      'Optional draggable camera bubble overlay',
      'Auto subtitles via Alibaba Qwen ASR (Pro)',
      'AI-generated structured handouts (Max)',
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
    publisher: { '@type': 'Organization', name: 'Excalicast' },
  };
}

/** Organization — brand entity. */
export function organizationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Excalicast',
    url: SITE_URL,
    logo: `${SITE_URL}/en/icon.png`,
    description:
      'Excalicast is a browser-based whiteboard recorder that captures the operation stream and voice, then exports MP4 in multiple aspect ratios.',
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
