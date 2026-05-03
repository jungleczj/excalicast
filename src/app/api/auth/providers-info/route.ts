import { NextResponse } from 'next/server';
import { enabledProviders } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 给 LoginModal 用：告诉前端哪些 provider 已配置
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(enabledProviders);
}
