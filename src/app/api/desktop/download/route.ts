import { NextRequest, NextResponse } from 'next/server';
import { resolveDesktopDownloadUrl } from '@/desktop/downloadContract';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const platform = request.nextUrl.searchParams.get('platform') ?? 'mac';
  try {
    const location = resolveDesktopDownloadUrl(platform as 'mac');
    const response = NextResponse.redirect(location, 307);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'desktop_platform_unsupported' }, { status: 400 });
  }
}
