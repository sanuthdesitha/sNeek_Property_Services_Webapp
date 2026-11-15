import "server-only";
/**
 * Two-step backup codes (2026-11-17): storage, use and status.
 *
 * Only hashes are stored (TwoFactorBackupCode.codeHash). New codes use a keyed
 * hash, HMAC-SHA256 with the server secret over a fixed label, the person's id
 * and the normalised code, the same keyed approach as email sign-in codes
 * (lib/auth/otp.ts) and trusted-device tokens. A keyed hash (rather than
 * bcrypt) lets a use be one conditional UPDATE on the exact row, which is what
 * makes it single-use under concurrency; without the server secret the stored
 * hashes cannot be tested offline. Older sets copied from the retired
 * User.twoFactorBackupCodes column are plain sha256 ("sha256-legacy") and keep
 * working until the person makes a new set.
 *
 * Plain codes exist only in the response that shows them once. They are never
 * logged, audited or returned again.
 */
import { createHash, createHmac, randomInt, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  generateBackupCodeSet,
  normalizeBackupCodeInput,
} from "./backup-code-format";

export const BACKUP_CODE_SCHEME = "hmac-sha256-v1";
export const LEGACY_BACKUP_CODE_SCHEME = "sha256-legacy";

type Tx = Prisma.TransactionClient;

export type BackupCodeStatus = {
  /** Codes in the current set (used or not); 0 when there is none. */
  total: number;
  remaining: number;
  /** ISO time the current set was made; null when there is none or it was not recorded. */
  createdAt: string | null;
  /** The set was copied from the older store, so its creation time is not recorded. */
  olderSet: boolean;
};

export type NewBackupCodeSet = {
  codes: string[];
  setId: string;
  createdAt: Date;
  replaced: number;
};

export type BackupCodeUse =
  | { ok: true; codeId: string; setId: string; usedAt: Date; remaining: number }
  | { ok: false; reason: "no_match" };

function hashSecret(): string {
  const value = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("Backup codes need NEXTAUTH_SECRET on the server.");
  return "dev-secret";
}

/** The stored hash of one code for one person (new scheme). */
export function hashBackupCode(userId: string, code: string): string {
  return createHmac("sha256", hashSecret())
    .update(`sneek-2fa-backup:v1:${userId}:${normalizeBackupCodeInput(code)}`)
    .digest("hex");
}

/** Hashes an older code may have been stored under (lower-case "xxxxx-xxxxx"). */
function legacyHashes(input: string): string[] {
  const lower = input.trim().toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const forms = new Set([lower]);
  if (compact.length === BACKUP_CODE_LENGTH) forms.add(`${compact.slice(0, 5)}-${compact.slice(5)}`);
  return Array.from(forms, (form) => createHash("sha256").update(form).digest("hex"));
}

/** Every hash a typed code could match for this person. */
export function candidateHashes(userId: string, input: string): string[] {
  return [hashBackupCode(userId, input), ...legacyHashes(input)];
}

/**
 * Replace the person's backup codes with a new set of ten, inside the
 * caller's transaction (so enabling two-step and its audit row commit
 * together). Every older code stops working in the same commit.
 */
export async function createBackupCodeSet(tx: Tx, userId: string, now = new Date()): Promise<NewBackupCodeSet> {
  const codes = generateBackupCodeSet(randomInt, BACKUP_CODE_COUNT);
  const setId = randomUUID();
  const removed = await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  await tx.twoFactorBackupCode.createMany({
    data: codes.map((code) => ({ userId, setId, codeHash: hashBackupCode(userId, code), hashScheme: BACKUP_CODE_SCHEME, createdAt: now })),
  });
  return { codes, setId, createdAt: now, replaced: removed.count };
}

/** Delete every backup code of the person (two-step turned off or reset). Returns how many. */
export async function deleteBackupCodes(tx: Tx, userId: string): Promise<number> {
  const removed = await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
  return removed.count;
}

/**
 * Use one code. A single conditional UPDATE (`usedAt IS NULL`) claims it, so
 * of two attempts with the same code exactly one succeeds: PostgreSQL re-reads
 * the row after the first commit and the second matches nothing.
 */
export async function redeemBackupCode(userId: string, input: string, now = new Date()): Promise<BackupCodeUse> {
  if (normalizeBackupCodeInput(input).length !== BACKUP_CODE_LENGTH) return { ok: false, reason: "no_match" };
  const hashes = candidateHashes(userId, input);
  const match = await db.twoFactorBackupCode.findFirst({
    where: { userId, codeHash: { in: hashes }, usedAt: null },
    select: { id: true, setId: true },
  });
  if (!match) return { ok: false, reason: "no_match" };
  const claimed = await db.twoFactorBackupCode.updateMany({ where: { id: match.id, userId, usedAt: null }, data: { usedAt: now } });
  if (claimed.count !== 1) return { ok: false, reason: "no_match" };
  const remaining = await db.twoFactorBackupCode.count({ where: { userId, usedAt: null } });
  return { ok: true, codeId: match.id, setId: match.setId, usedAt: now, remaining };
}

/** What the profile shows: whether codes exist, how many remain, when they were made. Never the codes. */
export async function backupCodeStatus(userId: string, reader: Pick<Tx, "twoFactorBackupCode"> = db): Promise<BackupCodeStatus> {
  const rows = await reader.twoFactorBackupCode.findMany({
    where: { userId },
    select: { createdAt: true, usedAt: true, hashScheme: true },
  });
  return summarizeBackupCodes(rows);
}

export function summarizeBackupCodes(rows: ReadonlyArray<{ createdAt: Date | null; usedAt: Date | null; hashScheme: string }>): BackupCodeStatus {
  if (rows.length === 0) return { total: 0, remaining: 0, createdAt: null, olderSet: false };
  const olderSet = rows.some((row) => row.hashScheme === LEGACY_BACKUP_CODE_SCHEME);
  const dates = rows.map((row) => row.createdAt?.getTime()).filter((value): value is number => typeof value === "number");
  return {
    // An older copied set only kept its unused codes, so its size is what was copied.
    total: rows.length,
    remaining: rows.filter((row) => !row.usedAt).length,
    createdAt: !olderSet && dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    olderSet,
  };
}
