import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { authenticator } from "otplib";
import { db } from "@/lib/db";
import { generateOtpCode, hashOtp, otpExpiresAt } from "@/lib/auth/otp";

/**
 * Two-factor authentication primitives — TOTP (authenticator app) + email
 * one-time codes, backup codes, a short-lived "2FA passed" proof cookie, and
 * long-lived "remember this device" tokens. The login flow runs the 2FA check
 * BEFORE NextAuth signIn and sets the proof cookie; authorize() then only has to
 * validate that cookie (it can read the raw cookie header), so no second factor
 * is ever minted inside NextAuth itself.
 */

const TOTP_ISSUER = "sNeek Ops";
const TWO_FA_OK_MINUTES = 10;
export const TRUSTED_DEVICE_DAYS = 30;

export const TWO_FA_OK_COOKIE = "sneek_2fa_ok";
export const TRUSTED_DEVICE_COOKIE = "sneek_td";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "dev-secret";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── TOTP (authenticator app) ──────────────────────────────────────────────

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(email: string, totpSecret: string): string {
  return authenticator.keyuri(email, TOTP_ISSUER, totpSecret);
}

export function verifyTotp(token: string, totpSecret: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s+/g, ""), secret: totpSecret });
  } catch {
    return false;
  }
}

// ── Backup codes ────────────────────────────────────────────────────────────

/** Generate display codes + their hashes (only hashes are stored). */
export function generateBackupCodes(count = 10): { plain: string[]; hashedJson: string } {
  const plain: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  const hashed = plain.map((c) => sha256(c.toLowerCase()));
  return { plain, hashedJson: JSON.stringify(hashed) };
}

/** Returns ok + the new (consumed) backup-code JSON when a code matches. */
export function consumeBackupCode(
  input: string,
  hashedJson: string | null,
): { ok: boolean; remainingJson?: string } {
  if (!hashedJson) return { ok: false };
  let arr: string[] = [];
  try {
    arr = JSON.parse(hashedJson);
  } catch {
    return { ok: false };
  }
  const h = sha256(input.trim().toLowerCase());
  const idx = arr.indexOf(h);
  if (idx === -1) return { ok: false };
  arr.splice(idx, 1);
  return { ok: true, remainingJson: JSON.stringify(arr) };
}

export function countBackupCodes(hashedJson: string | null): number {
  if (!hashedJson) return 0;
  try {
    return (JSON.parse(hashedJson) as string[]).length;
  } catch {
    return 0;
  }
}

// ── Short-lived "2FA passed" proof cookie ─────────────────────────────────────

export function signTwoFaOk(email: string): string {
  const exp = Date.now() + TWO_FA_OK_MINUTES * 60 * 1000;
  const payload = `${email.toLowerCase()}.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyTwoFaOk(cookieValue: string | undefined, email: string): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [em, expStr, sig] = parts;
  const expected = createHmac("sha256", secret()).update(`${em}.${expStr}`).digest("hex");
  if (!safeEqual(sig, expected)) return false;
  if (em !== email.toLowerCase()) return false;
  const exp = Number.parseInt(expStr, 10);
  return Number.isFinite(exp) && exp > Date.now();
}

// ── Trusted-device ("remember this device") tokens ────────────────────────────

export function newTrustedDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: sha256(token) };
}

export async function createTrustedDevice(userId: string, token: string, userAgent?: string | null): Promise<void> {
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000);
  await db.trustedDevice.create({
    data: { userId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 300) ?? null, expiresAt },
  });
}

export async function isTrustedDevice(userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await db.trustedDevice.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.userId !== userId) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

// ── Email one-time code (reuses the OTP hashing + VerificationToken store) ─────

export async function issueEmailTwoFaCode(email: string): Promise<string> {
  const identifier = `2fa:${email.toLowerCase()}`;
  const code = generateOtpCode();
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: { identifier, token: hashOtp(identifier, code), expires: otpExpiresAt() },
  });
  return code;
}

export async function verifyEmailTwoFaCode(email: string, code: string): Promise<boolean> {
  const identifier = `2fa:${email.toLowerCase()}`;
  const token = hashOtp(identifier, code.trim());
  const row = await db.verificationToken.findFirst({ where: { identifier, token } });
  if (!row) return false;
  await db.verificationToken.deleteMany({ where: { identifier } });
  return row.expires.getTime() > Date.now();
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

/** Parse a single cookie out of a raw Cookie header (used inside authorize()). */
export function readCookieFromHeader(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(/; */)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

export function twoFaOkCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TWO_FA_OK_MINUTES * 60,
  };
}

export function trustedDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60,
  };
}
