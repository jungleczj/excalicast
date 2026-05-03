import { NextResponse } from 'next/server';
import {
  hashPassword,
  isValidEmail,
  isValidPassword,
  startSessionForUser,
  toPublicUser,
} from '@/lib/auth';
import { getUserByEmail, insertUser } from '@/lib/db';

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

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  if (!isValidPassword(password)) {
    return NextResponse.json({ error: 'invalid_password', message: '密码至少 6 位' }, { status: 400 });
  }

  if (getUserByEmail(email)) {
    return NextResponse.json({ error: 'email_taken', message: '邮箱已注册' }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const user = insertUser(email, passwordHash);
  await startSessionForUser(user.id);

  return NextResponse.json({ user: toPublicUser(user) });
}
