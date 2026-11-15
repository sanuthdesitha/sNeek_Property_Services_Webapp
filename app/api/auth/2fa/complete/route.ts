import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  TRUSTED_DEVICE_COOKIE,
  TWO_FA_OK_COOKIE,
  createTrustedDevice,
  newTrustedDeviceToken,
  signTwoFaOk,
  trustedDeviceCookieOptions,
  twoFaOkCookieOptions,
  verifyEmailTwoFaCode,
  verifyTotp,
} from "@/lib/auth/twofactor";
import {
  twoFaKey,
  ensureNotLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
} from "@/lib/auth/login-lockout";
import { redeemBackupCode } from "@/lib/auth/backup-codes";
import { BACKUP_CODES_LOW, looksLikeBackupCode, type BackupCodeSignInOutcome } from "@/lib/auth/backup-code-format";
import { sendBackupCodeUsedNotice } from "@/lib/auth/backup-code-notice";
import { canMakeBackupCodesInProfile, twoStepSettingsPath } from "@/lib/auth/two-step-policy";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function auditBackupAttempt(userId: string, action: "TWO_FACTOR_BACKUP_CODE_USED" | "TWO_FACTOR_BACKUP_CODE_FAILED", after: Record<string, unknown>) {
  // Never the code: only what happened, the set and how many remain.
  await db.auditLog.create({ data: { userId, action, entity: "User", entityId: userId, after: after as never } }).catch(() => undefined);
}

/**
 * Step 2 of sign-in: verify the second factor (TOTP / email code / backup code)
 * and, on success, set the short-lived proof cookie that authorize() checks —
 * plus a long-lived trusted-device cookie when "remember this device" is ticked.
 * The client then calls signIn() normally.
 *
 * Backup codes (2026-11-17): `method: "backup"` (the sign-in screen's "Use a
 * backup code"), or any 10-character code for older callers. A code is used
 * with one conditional update (lib/auth/backup-codes.ts), so two attempts with
 * the same code cannot both pass. Wrong backup codes count against the same
 * two-step lockout as wrong 6-digit codes. Use and failure are audited without
 * the code; a use sends the account holder an inbox notice and an email.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const remember = body.remember === true;
    const backupRequested = body.method === "backup";
    if (!email || !password || !code) {
      return NextResponse.json({ error: "Missing details." }, { status: 400 });
    }

    // Brute-force lockout on the 2FA code (a 6-digit email code / backup code is
    // otherwise unthrottled). Tracked separately from the password lockout.
    const lock = await ensureNotLockedOut(twoFaKey(email));
    if (!lock.ok) {
      return NextResponse.json({ error: lock.message }, { status: 429 });
    }

    const user = await db.user.findUnique({ where: { email } });
    const passwordOk =
      !!user?.passwordHash && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !passwordOk) {
      await recordFailedAttempt(twoFaKey(email));
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }
    if (!user.twoFactorEnabled) {
      // Nothing to verify; let the normal signIn proceed.
      return NextResponse.json({ ok: true });
    }

    let verified = false;
    if (!backupRequested) {
      if (user.twoFactorMethod === "TOTP" && user.totpSecret) {
        verified = verifyTotp(code, user.totpSecret);
      } else if (user.twoFactorMethod === "EMAIL") {
        verified = await verifyEmailTwoFaCode(email, code);
      }
    }

    // A one-time backup code: asked for explicitly, or a 10-character code from an older screen.
    let backupOutcome: BackupCodeSignInOutcome | null = null;
    const backupAttempt = !verified && (backupRequested || looksLikeBackupCode(code));
    if (backupAttempt) {
      const use = await redeemBackupCode(user.id, code);
      if (use.ok) {
        verified = true;
        const settingsPath = twoStepSettingsPath(user.role);
        backupOutcome = {
          remaining: use.remaining,
          makeNewSuggested: use.remaining <= BACKUP_CODES_LOW,
          newCodesPath: canMakeBackupCodesInProfile(user.role) ? settingsPath : null,
          settingsPath,
        };
        const userAgent = req.headers.get("user-agent");
        await auditBackupAttempt(user.id, "TWO_FACTOR_BACKUP_CODE_USED", { setId: use.setId, remaining: use.remaining, via: "sign_in" });
        await sendBackupCodeUsedNotice({
          user: { id: user.id, role: user.role, name: user.name, email: user.email },
          codeId: use.codeId,
          usedAt: use.usedAt,
          remaining: use.remaining,
          userAgent,
        }).catch(() => undefined);
      } else {
        await auditBackupAttempt(user.id, "TWO_FACTOR_BACKUP_CODE_FAILED", { reason: "not_accepted", via: "sign_in" });
      }
    }

    if (!verified) {
      await recordFailedAttempt(twoFaKey(email));
      return NextResponse.json(
        { error: backupRequested ? "That backup code was not accepted. Each code works once." : "Invalid or expired code." },
        { status: 401, headers: NO_STORE },
      );
    }
    // Second factor passed — clear the counter.
    await clearFailedAttempts(twoFaKey(email));

    const res = NextResponse.json(backupOutcome ? { ok: true, backupCode: backupOutcome } : { ok: true }, { headers: NO_STORE });
    res.cookies.set(TWO_FA_OK_COOKIE, signTwoFaOk(email), twoFaOkCookieOptions());
    if (remember) {
      const { token } = newTrustedDeviceToken();
      await createTrustedDevice(user.id, token, req.headers.get("user-agent"));
      res.cookies.set(TRUSTED_DEVICE_COOKIE, token, trustedDeviceCookieOptions());
    }
    return res;
  } catch {
    return NextResponse.json({ error: "Could not verify code." }, { status: 400 });
  }
}
