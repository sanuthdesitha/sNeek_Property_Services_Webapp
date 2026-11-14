import "server-only";
/**
 * A PERSON'S OWN SENSITIVE-ACTION PIN: storage, attempts and lockout.
 *
 * One `UserSecurityPin` row per person. The PIN is hashed with the same bcrypt
 * the account passwords use and is never stored, logged or returned in clear.
 * Wrong attempts are counted on the row (not in memory), so the lockout holds
 * across server instances: PIN_LOCK_THRESHOLD wrong attempts in a row lock
 * verification for PIN_LOCK_MINUTES. A correct attempt clears the count.
 *
 * Every change is audited against the person who made it, without the PIN.
 */
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PIN_LOCK_MINUTES, PIN_LOCK_THRESHOLD } from "./pin-rules";

const BCRYPT_ROUNDS = 10;

export type OwnPinRow = {
  userId: string;
  pinHash: string | null;
  pinSetAt: Date | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  resetAt: Date | null;
};

export type OwnPinState = {
  hasPin: boolean;
  /** ISO time the PIN was last set; null when there is none or the time is not known. */
  updatedAt: string | null;
  /** ISO time verification unlocks again; null when not locked. */
  lockedUntil: string | null;
  /** True when an administrator cleared this person's PIN and they have not set a new one. */
  resetByAdministrator: boolean;
  /** Wrong PIN or password tries left before verification locks (PIN_LOCK_THRESHOLD when none failed). */
  attemptsLeft: number;
};

export async function readOwnPin(userId: string): Promise<OwnPinRow | null> {
  return db.userSecurityPin.findUnique({
    where: { userId },
    select: { userId: true, pinHash: true, pinSetAt: true, failedAttempts: true, lockedUntil: true, resetAt: true },
  });
}

export function isLocked(row: Pick<OwnPinRow, "lockedUntil"> | null, now = new Date()): boolean {
  return Boolean(row?.lockedUntil && row.lockedUntil.getTime() > now.getTime());
}

export async function ownPinState(userId: string, now = new Date()): Promise<OwnPinState> {
  const row = await readOwnPin(userId);
  return {
    hasPin: Boolean(row?.pinHash),
    updatedAt: row?.pinHash && row.pinSetAt ? row.pinSetAt.toISOString() : null,
    lockedUntil: isLocked(row, now) ? row!.lockedUntil!.toISOString() : null,
    resetByAdministrator: Boolean(row && !row.pinHash && row.resetAt),
    attemptsLeft: Math.max(0, PIN_LOCK_THRESHOLD - (row?.failedAttempts ?? 0)),
  };
}

export async function pinMatches(row: Pick<OwnPinRow, "pinHash"> | null, pin: string): Promise<boolean> {
  if (!row?.pinHash || !pin) return false;
  return bcrypt.compare(pin, row.pinHash);
}

async function audit(userId: string, action: string, entityId: string, after: Record<string, unknown>) {
  await db.auditLog
    .create({ data: { userId, action, entity: "UserSecurityPin", entityId, after: after as Prisma.InputJsonValue } })
    .catch(() => undefined);
}

/** Count one wrong PIN or password. Locks verification when the threshold is reached. */
export async function recordPinFailure(userId: string, now = new Date()): Promise<{ locked: boolean }> {
  const row = await db.userSecurityPin.upsert({
    where: { userId },
    create: { userId, failedAttempts: 1, lastFailedAt: now },
    update: { failedAttempts: { increment: 1 }, lastFailedAt: now },
    select: { failedAttempts: true },
  });
  if (row.failedAttempts < PIN_LOCK_THRESHOLD) return { locked: false };
  const lockedUntil = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000);
  await db.userSecurityPin.update({ where: { userId }, data: { lockedUntil, failedAttempts: 0 } });
  await audit(userId, "SECURITY_PIN_LOCKED", userId, { lockedUntil: lockedUntil.toISOString(), attempts: PIN_LOCK_THRESHOLD });
  return { locked: true };
}

/** A correct PIN or password: the wrong-attempt count starts again. */
export async function clearPinFailures(userId: string): Promise<void> {
  await db.userSecurityPin.updateMany({
    where: { userId, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
    data: { failedAttempts: 0, lockedUntil: null },
  });
}

export type PinChangeSource = "profile" | "sensitive-action";

/** Store a new PIN for this person (already validated). Audited without the PIN. */
export async function storeOwnPin(userId: string, pin: string, source: PinChangeSource, now = new Date()): Promise<void> {
  const existing = await readOwnPin(userId);
  const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
  await db.userSecurityPin.upsert({
    where: { userId },
    create: { userId, pinHash, pinSetAt: now },
    update: { pinHash, pinSetAt: now, failedAttempts: 0, lockedUntil: null, resetAt: null, resetById: null },
  });
  await audit(userId, existing?.pinHash ? "SECURITY_PIN_CHANGED" : "SECURITY_PIN_SET", userId, { source });
}

/** The person removes their own PIN (their next sensitive action asks them to set one). */
export async function removeOwnPin(userId: string): Promise<void> {
  await db.userSecurityPin.updateMany({ where: { userId }, data: { pinHash: null, pinSetAt: null } });
  await audit(userId, "SECURITY_PIN_REMOVED", userId, { source: "profile" });
}

/**
 * An administrator clears another person's PIN so they must set a new one.
 * The administrator never sees or chooses it. Also lifts a lockout.
 */
export async function resetPersonPin(actorId: string, targetId: string, now = new Date()): Promise<{ hadPin: boolean }> {
  const existing = await readOwnPin(targetId);
  await db.userSecurityPin.upsert({
    where: { userId: targetId },
    create: { userId: targetId, resetAt: now, resetById: actorId },
    update: { pinHash: null, pinSetAt: null, failedAttempts: 0, lockedUntil: null, resetAt: now, resetById: actorId },
  });
  await audit(actorId, "SECURITY_PIN_RESET", targetId, { targetUserId: targetId, actorId, hadPin: Boolean(existing?.pinHash) });
  return { hadPin: Boolean(existing?.pinHash) };
}
