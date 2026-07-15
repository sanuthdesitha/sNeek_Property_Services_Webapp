import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
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
      await sendEmail({
        to: email,
        subject: "Your sNeek Ops sign-in code",
        html: `<p>Your sign-in code is <strong style="font-size:22px;letter-spacing:2px">${code}</strong></p><p>It expires in 10 minutes. If you didn't try to sign in, ignore this email.</p>`,
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
