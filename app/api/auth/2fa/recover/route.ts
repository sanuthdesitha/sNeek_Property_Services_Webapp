import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { buildDesignedEmail } from "@/lib/email-design/build-email";
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
      // Fixed security email (design "twoFactorRecovery"); the name is escaped by the renderer.
      const content = buildDesignedEmail(await getAppSettings(), "twoFactorRecovery", { userName: user.name ?? "", recoveryUrl: link, expiryMinutes: String(RECOVERY_TTL_MINUTES) });
      await sendEmail({
        to: email,
        subject: content.subject,
        html: content.html,
        transactional: true,
        // 2FA recovery link — must never be silenced by audience controls.
        critical: true,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
