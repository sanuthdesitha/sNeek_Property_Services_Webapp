import { db } from "@/lib/db";

/**
 * DB-backed brute-force lockout for password login and 2FA code verification.
 *
 * Mirrors the OTP lockout (lib/auth/otp-state.ts) but in its own key namespace,
 * and stores state in the existing `appSetting` table so it survives serverless
 * restarts (the in-memory rate-limit util does NOT — it's per-instance). No
 * schema change required.
 *
 * Use a distinct namespace per surface so a password lockout and a 2FA-code
 * lockout for the same account are tracked separately:
 *   loginKey(email)  → password login attempts
 *   twoFaKey(email)  → 2FA code / backup-code attempts
 */

export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_LOCK_MINUTES = 15;

export function loginKey(email: string) {
  return `pw:${email.toLowerCase()}`;
}
export function twoFaKey(email: string) {
  return `2fa:${email.toLowerCase()}`;
}

interface LockoutState {
  failedAttempts: number;
  lockedUntil?: string;
}

function fullKey(identifier: string) {
  return `loginLockout:${identifier}`;
}

function sanitize(input: unknown): LockoutState {
  if (!input || typeof input !== "object") return { failedAttempts: 0 };
  const row = input as Record<string, unknown>;
  return {
    failedAttempts: Number.isFinite(Number(row.failedAttempts)) ? Math.max(0, Number(row.failedAttempts)) : 0,
    lockedUntil: typeof row.lockedUntil === "string" ? row.lockedUntil : undefined,
  };
}

async function getState(identifier: string): Promise<LockoutState> {
  const row = await db.appSetting.findUnique({ where: { key: fullKey(identifier) } });
  return row ? sanitize(row.value) : { failedAttempts: 0 };
}

async function saveState(identifier: string, state: LockoutState): Promise<void> {
  await db.appSetting.upsert({
    where: { key: fullKey(identifier) },
    create: { key: fullKey(identifier), value: state as any },
    update: { value: state as any },
  });
}

/** True (ok:false) when the identifier is currently locked out. */
export async function ensureNotLockedOut(
  identifier: string
): Promise<{ ok: true } | { ok: false; message: string; lockedUntil: Date }> {
  const state = await getState(identifier);
  if (!state.lockedUntil) return { ok: true };
  const lockedUntil = new Date(state.lockedUntil);
  if (!Number.isFinite(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
    // Expired — clear and allow.
    await saveState(identifier, { failedAttempts: 0 });
    return { ok: true };
  }
  const minutesLeft = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
  return {
    ok: false,
    lockedUntil,
    message: `Too many failed attempts. Try again in ${minutesLeft} minute(s).`,
  };
}

/** Record a failed attempt; locks the identifier once the cap is reached. */
export async function recordFailedAttempt(identifier: string): Promise<{ locked: boolean }> {
  const state = await getState(identifier);
  const failedAttempts = (state.failedAttempts ?? 0) + 1;
  if (failedAttempts >= LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000);
    await saveState(identifier, { failedAttempts, lockedUntil: lockedUntil.toISOString() });
    return { locked: true };
  }
  await saveState(identifier, { failedAttempts });
  return { locked: false };
}

/** Clear all failure state after a successful authentication. */
export async function clearFailedAttempts(identifier: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: fullKey(identifier) } });
}
