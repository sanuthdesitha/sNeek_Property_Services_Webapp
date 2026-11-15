import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueRecoveryToken } from "@/lib/auth/recovery";
import { passwordResetEmail, passwordResetLink } from "@/lib/auth/password-reset-email";
import { recordAccountEmail } from "@/lib/accounts/account-email-record";
import { rateLimit } from "@/lib/security/rate-limit";

/** Per address: at most this many reset emails per window (the answer is the same either way). */
const RESET_LIMIT = { limit: 3, windowMs: 15 * 60_000 };

/**
 * Start a password reset. Always returns ok (no account enumeration) — a link
 * is only emailed when the account actually exists and is active, and at most
 * three times per address every 15 minutes (2026-11-12: the route had no limit,
 * so anyone could flood a person's inbox). Each email sent is recorded for the
 * person's Accounts › Account emails history with the provider's real answer.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    if (!email) return NextResponse.json({ ok: true });
    if (!rateLimit(`forgot-password:${email}`, RESET_LIMIT).ok) return NextResponse.json({ ok: true });

    const user = await db.user.findUnique({ where: { email }, select: { id: true, isActive: true, name: true } });
    if (user && user.isActive) {
      const raw = await issueRecoveryToken("pwreset", email);
      const content = passwordResetEmail({ name: user.name, email, link: passwordResetLink(email, raw) });
      await recordAccountEmail({
        targetUserId: user.id,
        actorId: null,
        actorRole: null,
        type: "PASSWORD_RESET",
        origin: "SELF_SERVICE",
        to: email,
        // Password recovery — must never be silenced by audience controls.
        send: { to: email, subject: content.subject, html: content.html, transactional: true, critical: true },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Still return ok to avoid leaking anything.
    return NextResponse.json({ ok: true });
  }
}
