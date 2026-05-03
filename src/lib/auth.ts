import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  getUserById,
  type UserRow,
} from '@/lib/db';

const SESSION_COOKIE = 'excalicast_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const hash = scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export interface PublicUser {
  id: number;
  email: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email };
}

export async function startSessionForUser(userId: number): Promise<string> {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  createAuthSession(sessionId, userId, expiresAt);
  const c = await cookies();
  c.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return sessionId;
}

export async function endCurrentSession(): Promise<void> {
  const c = await cookies();
  const sessionId = c.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    deleteAuthSession(sessionId);
  }
  c.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const c = await cookies();
  const sessionId = c.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const sess = getAuthSession(sessionId);
  if (!sess) return null;
  if (sess.expires_at < Date.now()) {
    deleteAuthSession(sessionId);
    return null;
  }
  const user = getUserById(sess.user_id);
  if (!user) return null;
  return toPublicUser(user);
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isValidPassword(s: string): boolean {
  return typeof s === 'string' && s.length >= 6 && s.length <= 200;
}
