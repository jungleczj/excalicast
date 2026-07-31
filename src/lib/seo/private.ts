import type { Metadata } from 'next';

/** Shared metadata contract for authenticated, local-data, and user-generated routes. */
export const PRIVATE_PAGE_METADATA: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};
