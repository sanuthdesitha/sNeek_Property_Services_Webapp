import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { appBaseUrl, issueRecoveryToken, RECOVERY_TTL_MINUTES } from "@/lib/auth/recovery";

/**
 * "Lost my authenticator AND backup codes" — email a link that turns 2FA off so
 * the user can sign in with their password and re-enrol. Always returns ok; the
 * link is only sent when the account exists, is active, and has 2FA enabled.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    if (!email) return NextResponse.json({ ok: true });

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, isActive: true, twoFactorEnabled: true, name: true },
    });
    if (user && user.isActive && user.twoFactorEnabled) {
      const raw = await issueRecoveryToken("2fa-disable", email);
      const link = `${appBaseUrl()}/recover-2fa?email=${encodeURIComponent(email)}&token=${raw}`;
      await sendEmail({
        to: email,
        subject: "Turn off two-step verification",
        html: `<p>Hi ${user.name || "there"},</p><p>You asked to recover access because you can't complete two-step verification. Click below to switch 2FA off — this link expires in ${RECOVERY_TTL_MINUTES} minutes. After signing in, set up 2FA again from your profile.</p><p><a href="${link}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Turn off 2FA</a></p><p>If you didn't request this, ignore this email and your 2FA stays on.</p>`,
        transactional: true,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
