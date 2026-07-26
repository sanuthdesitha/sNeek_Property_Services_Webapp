import { createHmac, timingSafeEqual } from "crypto";

/**
 * "Test as" unlock proof — a short-lived, server-signed cookie proving that the
 * signed-in admin re-entered their credentials JUST NOW.
 *
 * WHY THIS EXISTS: being an ADMIN is not enough to open the Test-as console.
 * An unattended admin session is one click from acting as any user in the
 * business, so the picker AND `POST /api/admin/impersonate` both demand a fresh
 * re-auth. The credential check itself is the existing
 * `verifySensitiveAction()` (admin PIN or account password, bcrypt, same hashes
 * the login flow uses) — this module only carries the PROOF.
 *
 * The proof is a cookie, not sessionStorage (which is how the pricing page lock
 * works), because the API has to be able to enforce it: a direct
 * `POST /api/admin/impersonate` with no unlock must 403 regardless of what the
 * browser believes. Same HMAC shape as the 2FA proof cookie in
 * lib/auth/twofactor.ts: `<userId>.<expiryMs>.<hmac>`.
 *
 * Pure + synchronous on purpose — unit-tested in tests/lib/test-as-unlock.test.ts.
 */

export const TEST_AS_UNLOCK_COOKIE = "sneek.test-as-unlock";

/** Deliberately short: long enough to pick a user, too short to leave lying around. */
export const TEST_AS_UNLOCK_MINUTES = 15;

/** Brute-force budget per admin: 5 attempts per 15 minutes. */
export const TEST_AS_UNLOCK_MAX_ATTEMPTS = 5;
export const TEST_AS_UNLOCK_WINDOW_MS = 15 * 60 * 1000;

export function testAsUnlockRateKey(userId: string): string {
  return `test-as-unlock:${userId}`;
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Mint a proof for `userId`, valid for TEST_AS_UNLOCK_MINUTES from `now`. */
export function signTestAsUnlock(userId: string, now: number = Date.now()): string {
  const expiresAt = now + TEST_AS_UNLOCK_MINUTES * 60 * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export type TestAsUnlockToken = { userId: string; expiresAt: number };

/**
 * Signature- and shape-checked parse. Returns null for anything suspect
 * (tampered, wrong secret, malformed) WITHOUT considering expiry, so callers
 * can tell "forged" from "just timed out" if they ever need to.
 */
export function parseTestAsUnlockToken(token: string | undefined | null): TestAsUnlockToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, signature] = parts;
  if (!userId || !expStr || !signature) return null;
  if (!safeEqual(signature, sign(`${userId}.${expStr}`))) return null;
  const expiresAt = Number.parseInt(expStr, 10);
  if (!Number.isFinite(expiresAt)) return null;
  return { userId, expiresAt };
}

/** The full gate: signed by us, issued to THIS user, and not yet expired. */
export function isTestAsUnlocked(
  token: string | undefined | null,
  userId: string,
  now: number = Date.now(),
): boolean {
  const parsed = parseTestAsUnlockToken(token);
  if (!parsed) return false;
  if (parsed.userId !== userId) return false;
  return parsed.expiresAt > now;
}

export function testAsUnlockCookieOptions(maxAgeSeconds = TEST_AS_UNLOCK_MINUTES * 60) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
