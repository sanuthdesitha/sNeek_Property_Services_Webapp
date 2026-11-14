import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
import { TRUSTED_DEVICE_COOKIE, isTrustedDevice, issueEmailTwoFaCode } from "@/lib/auth/twofactor";

/**
 * Step 1 of sign-in: verify the password and report whether a second factor is
 * still needed. For the EMAIL method we dispatch the code now. We never reveal
 * 2FA status for a wrong password (returns required:false, so the subsequent
 * signIn just fails normally).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    const passwordOk =
      !!user?.passwordHash && user.isActive && (await bcrypt.compare(password, user.passwordHash));

    // Bad credentials, or 2FA not enabled → nothing extra to do here.
    if (!user || !passwordOk || !user.twoFactorEnabled) {
      return NextResponse.json({ ok: true, required: false });
    }

    // Remembered device → skip the prompt.
    const trustedToken = cookies().get(TRUSTED_DEVICE_COOKIE)?.value;
    if (await isTrustedDevice(user.id, trustedToken)) {
      return NextResponse.json({ ok: true, required: false, trusted: true });
    }

    if (user.twoFactorMethod === "EMAIL") {
      const code = await issueEmailTwoFaCode(email);
      // Fixed security email (design "twoFactorSignInCode"); the code is never in the subject.
      const content = buildDesignedEmail(await getAppSettings(), "twoFactorSignInCode", { code, expiryMinutes: "10" });
      await sendEmail({
        to: email,
        subject: content.subject,
        html: content.html,
        transactional: true,
        // 2FA sign-in code — must never be silenced by audience controls.
        critical: true,
      });
    }

    return NextResponse.json({ ok: true, required: true, method: user.twoFactorMethod });
  } catch {
    return NextResponse.json({ error: "Could not start sign in." }, { status: 400 });
  }
}
