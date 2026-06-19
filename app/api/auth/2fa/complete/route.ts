import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  TRUSTED_DEVICE_COOKIE,
  TWO_FA_OK_COOKIE,
  consumeBackupCode,
  createTrustedDevice,
  newTrustedDeviceToken,
  signTwoFaOk,
  trustedDeviceCookieOptions,
  twoFaOkCookieOptions,
  verifyEmailTwoFaCode,
  verifyTotp,
} from "@/lib/auth/twofactor";

/**
 * Step 2 of sign-in: verify the second factor (TOTP / email code / backup code)
 * and, on success, set the short-lived proof cookie that authorize() checks —
 * plus a long-lived trusted-device cookie when "remember this device" is ticked.
 * The client then calls signIn() normally.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const remember = body.remember === true;
    if (!email || !password || !code) {
      return NextResponse.json({ error: "Missing details." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    const passwordOk =
      !!user?.passwordHash && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !passwordOk) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }
    if (!user.twoFactorEnabled) {
      // Nothing to verify; let the normal signIn proceed.
      return NextResponse.json({ ok: true });
    }

    let verified = false;
    if (user.twoFactorMethod === "TOTP" && user.totpSecret) {
      verified = verifyTotp(code, user.totpSecret);
    } else if (user.twoFactorMethod === "EMAIL") {
      verified = await verifyEmailTwoFaCode(email, code);
    }

    // Fall back to a one-time backup code.
    if (!verified) {
      const result = consumeBackupCode(code, user.twoFactorBackupCodes);
      if (result.ok) {
        verified = true;
        await db.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: result.remainingJson },
        });
      }
    }

    if (!verified) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
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
