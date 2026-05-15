/**
 * Stateless magic-link JWT for email login.
 *
 * Why stateless: avoids Upstash / database dependency. The JWT itself
 * is the auth — short TTL (10 min) keeps the blast radius small if a
 * link leaks. Single-use is enforced by the token's exp, not by a
 * server-side revocation list.
 *
 * Threat model trade-off:
 *   - Risk: link captured before user clicks → attacker can use it
 *     within 10 minutes. Mitigated by short exp + Resend's TLS pipe.
 *   - Risk: link clicked twice → both work (no consumption record).
 *     Acceptable for the "login" verb — establishing a session twice
 *     is idempotent.
 * If single-use ever becomes a hard requirement, layer Upstash on top
 * (jti → consumed flag) without changing the call sites here.
 */

import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'excalicast';
const AUDIENCE = 'email-link';
const TTL_SECONDS = 10 * 60;

function getSecretBytes(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export interface EmailLinkClaims {
  email: string;
  exp: number; // unix seconds
  iat: number;
  iss: string;
  aud: string;
}

export async function signEmailLinkToken(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  return new SignJWT({ email: normalized })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecretBytes());
}

export async function verifyEmailLinkToken(token: string): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretBytes(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (!email.includes('@')) return null;
    return { email };
  } catch {
    return null;
  }
}
