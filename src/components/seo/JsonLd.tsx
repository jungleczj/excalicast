import type { JSX } from 'react';

/**
 * Injects a schema.org JSON-LD block. Server Component — renders inline in the
 * SSR HTML so search crawlers and generative engines (ChatGPT / Perplexity /
 * Google AI Overview) can parse structured facts about the product.
 *
 * Pass a single schema object or an array of them.
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}): JSX.Element {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; no user-controlled HTML.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
