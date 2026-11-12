import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { evaluateCapability } from "@/lib/rbac/access-evaluator";
import { SENSITIVE_ACTION_CAPABILITY } from "@/lib/rbac/capabilities";
import type { SensitiveAction } from "./sensitive-actions";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { actualActorRefusal } from "./actual-actor";
import {
  clearPinFailures,
  isLocked,
  ownPinState,
  pinMatches,
  readOwnPin,
  recordPinFailure,
  removeOwnPin,
  storeOwnPin,
  type OwnPinState,
} from "./own-pin";
import {
  newPinProblem,
  normalizePinInput,
  sensitiveVerificationErrorMessage,
  type SensitiveVerificationCode,
} from "./pin-rules";

/**
 * SENSITIVE-ACTION VERIFICATION WITH THE ACTING PERSON'S OWN PIN
 * (owner decision 2026-11-13).
 *
 * Before: each ADMIN / OPS_MANAGER could keep a personal PIN hash in the
 * `user_extended_profiles_v1` settings JSON, and the check accepted that PIN OR
 * the account password; there was no shared PIN in code, no lockout outside
 * Test-as, and the id checked was the session's — while testing as an
 * operations manager that was the target's account.
 *
 * Now (see docs/SYSTEM.md "Own PIN for sensitive actions"):
 *   - only the genuinely signed-in person, acting as themselves, is verified
 *     (`actualActorRefusal`): never another person's PIN, never while testing;
 *   - a person with a PIN confirms with that PIN only; the password is refused
 *     with PIN_REQUIRED (a forgotten PIN is changed in the profile with the
 *     password);
 *   - a person with no PIN yet (never set, or cleared by an administrator)
 *     confirms ONCE with their account password plus a new PIN, which becomes
 *     their PIN; a password alone answers PIN_SETUP_REQUIRED so the prompt can
 *     ask for the new PIN. Nobody is locked out by the change;
 *   - PIN_LOCK_THRESHOLD wrong PINs or passwords in a row lock verification for
 *     PIN_LOCK_MINUTES (stored on the person's row, so every instance sees it).
 */

export interface SensitiveActionCredentials {
  pin?: string | null | undefined;
  password?: string | null | undefined;
  /** Only while the person has no PIN: the PIN to set, confirmed with `password`. */
  newPin?: string | null | undefined;
}

export class SensitiveVerificationError extends Error {
  readonly code: SensitiveVerificationCode;
  constructor(code: SensitiveVerificationCode) {
    super(sensitiveVerificationErrorMessage(code));
    this.name = "SensitiveVerificationError";
    this.code = code;
  }
}

function refuse(code: SensitiveVerificationCode): never {
  throw new SensitiveVerificationError(code);
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** The person's own PIN state for their profile and for PIN prompts. Never includes the hash. */
export async function getAdminPinState(userId: string): Promise<OwnPinState> {
  return ownPinState(userId);
}

type PasswordUser = { passwordHash: string | null };

async function passwordMatches(user: PasswordUser, password: string): Promise<boolean> {
  if (!password || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

/** Set or change this person's own PIN after checking their current password (profile). */
export async function setAdminPin(userId: string, pin: string, currentPassword: string): Promise<void> {
  const problem = newPinProblem(pin);
  if (problem) throw new Error(problem);
  const row = await readOwnPin(userId);
  if (isLocked(row)) refuse("PIN_LOCKED");
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await passwordMatches(user, normalizePassword(currentPassword)))) {
    await recordPinFailure(userId);
    throw new Error("Current password is incorrect.");
  }
  await clearPinFailures(userId);
  await storeOwnPin(userId, pin.trim(), "profile");
}

/** Remove this person's own PIN after checking their current password (profile). */
export async function clearAdminPin(userId: string, currentPassword: string): Promise<void> {
  const row = await readOwnPin(userId);
  if (isLocked(row)) refuse("PIN_LOCKED");
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await passwordMatches(user, normalizePassword(currentPassword)))) {
    await recordPinFailure(userId);
    throw new Error("Current password is incorrect.");
  }
  await clearPinFailures(userId);
  await removeOwnPin(userId);
}

export async function verifySensitiveAction(
  userId: string,
  credentials: SensitiveActionCredentials | null | undefined,
  action?: SensitiveAction,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      passwordHash: true,
      isActive: true,
      extraRoles: { select: { role: true } },
    },
  });

  if (!user?.isActive) refuse("UNAUTHORIZED");
  const roles = [user.role, ...(user.extraRoles ?? []).map((row) => row.role)];
  if (!roles.includes(Role.ADMIN) && !roles.includes(Role.OPS_MANAGER)) refuse("FORBIDDEN");

  // The actual actor rule: the signed-in person, acting as themselves.
  const actorRefusal = await actualActorRefusal(userId);
  if (actorRefusal) refuse(actorRefusal);

  // The shared evaluator: an explicit grant, or the area at Full. The PIN
  // below is still required at Full (owner decision 2026-11-12).
  if (!roles.includes(Role.ADMIN) && action) {
    const subject = { id: userId, role: String(user.role), heldRoles: roles.map(String) };
    if (!evaluateCapability(await getOpsPolicy(), subject, SENSITIVE_ACTION_CAPABILITY[action])) refuse("FORBIDDEN");
  }

  const row = await readOwnPin(userId);
  if (isLocked(row)) refuse("PIN_LOCKED");

  const pin = normalizePinInput(credentials?.pin);
  const password = normalizePassword(credentials?.password);
  const newPin = typeof credentials?.newPin === "string" ? credentials.newPin.trim() : "";

  if (row?.pinHash) {
    if (!pin) refuse(password ? "PIN_REQUIRED" : "PIN_OR_PASSWORD_REQUIRED");
    if (await pinMatches(row, pin)) {
      await clearPinFailures(userId);
      return true;
    }
    const { locked } = await recordPinFailure(userId);
    refuse(locked ? "PIN_LOCKED" : "INVALID_SECURITY_VERIFICATION");
  }

  // No PIN yet: the account password, once, together with the PIN to set.
  if (!password || !newPin) refuse("PIN_SETUP_REQUIRED");
  if (newPinProblem(newPin)) refuse("NEW_PIN_INVALID");
  if (!(await passwordMatches(user, password))) {
    const { locked } = await recordPinFailure(userId);
    refuse(locked ? "PIN_LOCKED" : "INVALID_SECURITY_VERIFICATION");
  }
  await clearPinFailures(userId);
  await storeOwnPin(userId, newPin, "sensitive-action");
  return true;
}

/**
 * A refused credential (wrong, missing, not set up, locked): routes answer 423
 * for these, as they always did for the historic two codes. UNAUTHORIZED,
 * FORBIDDEN and the actual actor rule are not credential refusals.
 */
export function isSensitiveRefusal(error: unknown): boolean {
  if (error instanceof SensitiveVerificationError) {
    return !["UNAUTHORIZED", "FORBIDDEN", "ACTUAL_ACTOR_REQUIRED"].includes(error.code);
  }
  const message = error instanceof Error ? error.message : "";
  return message === "INVALID_SECURITY_VERIFICATION" || message === "PIN_OR_PASSWORD_REQUIRED";
}
