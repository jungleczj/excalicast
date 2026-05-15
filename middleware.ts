import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

/**
 * Run middleware on every page + API route except the static assets and
 * the Paddle webhook (which validates via HMAC signature, not session,
 * and must not be slowed down or have its cookies modified).
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api/paddle-webhook|api/asr/audio).*)',
  ],
};
