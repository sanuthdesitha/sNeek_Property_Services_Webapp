import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

/**
 * Single-use, time-boxed recovery tokens for self-service account recovery
 * (password reset + "lost my 2FA" disable). We store only a SHA-256 hash of the
 * raw token in VerificationToken; the raw token travels in the emailed link.
 */

const TTL_MINUTES = 30;

export type RecoveryKind = "pwreset" | "2fa-disable";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function issueRecoveryToken(kind: RecoveryKind, email: string): Promise<string> {
  const identifier = `${kind}:${email.toLowerCase()}`;
  const raw = randomBytes(32).toString("hex");
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: { identifier, token: sha256(raw), expires: new Date(Date.now() + TTL_MINUTES * 60 * 1000) },
  });
  return raw;
}

/** Returns true once (consumes the token) when valid + unexpired. */
export async function consumeRecoveryToken(kind: RecoveryKind, email: string, raw: string): Promise<boolean> {
  const identifier = `${kind}:${email.toLowerCase()}`;
  const row = await db.verificationToken.findFirst({ where: { identifier, token: sha256(raw) } });
  if (!row) return false;
  await db.verificationToken.deleteMany({ where: { identifier } });
  return row.expires.getTime() > Date.now();
}

export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export const RECOVERY_TTL_MINUTES = TTL_MINUTES;
