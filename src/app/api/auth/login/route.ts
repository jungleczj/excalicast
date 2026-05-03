import { NextResponse } from 'next/server';
import {
  isValidEmail,
  isValidPassword,
  startSessionForUser,
  toPublicUser,
  verifyPassword,
} from '@/lib/auth';
import { getUserByEmail } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!isValidEmail(email) || !isValidPassword(password)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 400 });
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'invalid_credentials', message: '邮箱或密码错误' }, { status: 401 });
  }

  await startSessionForUser(user.id);
  return NextResponse.json({ user: toPublicUser(user) });
}
