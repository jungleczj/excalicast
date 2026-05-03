import { NextResponse } from 'next/server';
import { endCurrentSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  await endCurrentSession();
  return NextResponse.json({ ok: true });
}
