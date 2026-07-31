import type { ReactNode } from 'react';
import { PRIVATE_PAGE_METADATA } from '@/lib/seo/private';

export const metadata = PRIVATE_PAGE_METADATA;

export default function AppLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
