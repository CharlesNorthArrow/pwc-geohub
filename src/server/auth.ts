/**
 * Auth seam — one choke-point for role checks.
 *
 * First impl: HttpOnly session cookie whose value is the admin password
 * itself, compared timing-safely against process.env.ADMIN_PASSWORD. This
 * gets us out the door without standing up a user table; rotating the env
 * var invalidates every existing session.
 *
 * Every admin surface — pages AND routes — calls `requireRole('admin')` as
 * its very first line. The function either resolves silently (request is
 * authorized) or throws `UnauthorizedError` (caller decides how to surface
 * the 401: redirect for pages, JSON for routes).
 *
 * Why a seam: when SSO / a real user table / JWT lands, only this file
 * changes. Call sites stay one line.
 *
 * Safety properties:
 *  - Fail-closed: missing or empty ADMIN_PASSWORD denies every request.
 *  - Timing-safe comparison (avoids leaking password length via response time).
 *  - Cookie is HttpOnly + Secure (in prod) + SameSite=Lax — no JS read, no
 *    cross-site send.
 *  - Password never round-trips back to the client; the login response is
 *    a redirect/204 with Set-Cookie, no body.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';

export type Role = 'admin';
export const ADMIN_COOKIE = 'pwc_admin_session';
const COOKIE_MAX_AGE_S = 8 * 60 * 60; // 8h

export class UnauthorizedError extends Error {
  constructor(reason = 'unauthorized') {
    super(reason);
    this.name = 'UnauthorizedError';
  }
}

/**
 * The one auth gate. Resolves on success; throws `UnauthorizedError` on
 * failure. Server-only — never expose to client bundles.
 */
export async function requireRole(role: Role): Promise<void> {
  if (role !== 'admin') throw new UnauthorizedError('unknown_role');
  const ok = await hasValidAdminSession();
  if (!ok) throw new UnauthorizedError('no_session');
}

/**
 * Pure check (no throw) — useful for layouts that want to render a login
 * form instead of bubbling an error to an error boundary.
 */
export async function hasValidAdminSession(): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length === 0) return false;
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  return timingSafeEqualString(token, expected);
}

/**
 * Server-action helper. Verifies the submitted password and, on match,
 * writes the session cookie. Returns `{ok: true}` or `{ok: false, reason}`;
 * the password value is never echoed back, and "reason" stays generic so
 * timing/error responses don't leak password length.
 */
export async function startAdminSession(submitted: string): Promise<{ ok: boolean }> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length === 0) return { ok: false };
  if (!timingSafeEqualString(submitted, expected)) return { ok: false };
  const store = await cookies();
  store.set({
    name: ADMIN_COOKIE,
    value: expected,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // path='/' so the cookie is sent with both the /admin page AND the
    // /api/admin/* routes the page calls. Scoping to /admin would gate the
    // page but 401 every XHR — they're different path prefixes.
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  return { ok: true };
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  // Clear at the current ('/') path AND at the legacy ('/admin') path so
  // pre-fix sessions get fully reaped on next sign-out.
  store.set({ name: ADMIN_COOKIE, value: '', path: '/', maxAge: 0 });
  store.set({ name: ADMIN_COOKIE, value: '', path: '/admin', maxAge: 0 });
}

/**
 * Constant-time string compare. We pad to the longer length so length
 * mismatch doesn't short-circuit and leak via timing — the result still
 * comes out false either way.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && aBuf.length === bBuf.length;
}
