import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { appBaseUrl, issueRecoveryToken, RECOVERY_TTL_MINUTES } from "@/lib/auth/recovery";

/**
 * Start a password reset. Always returns ok (no account enumeration) — a link
 * is only emailed when the account actually exists and is active.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    if (!email) return NextResponse.json({ ok: true });

    const user = await db.user.findUnique({ where: { email }, select: { id: true, isActive: true, name: true } });
    if (user && user.isActive) {
      const raw = await issueRecoveryToken("pwreset", email);
      const link = `${appBaseUrl()}/reset-password?email=${encodeURIComponent(email)}&token=${raw}`;
      await sendEmail({
        to: email,
        subject: "Reset your sNeek password",
        html: `<p>Hi ${user.name || "there"},</p><p>We received a request to reset your password. Click below to set a new one — this link expires in ${RECOVERY_TTL_MINUTES} minutes.</p><p><a href="${link}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Reset password</a></p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
        transactional: true,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Still return ok to avoid leaking anything.
    return NextResponse.json({ ok: true });
  }
}
