import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { verifySensitiveAction } from "@/lib/security/admin-verification";

/**
 * Admin-side 2FA reset: turn off a user's two-step verification and forget their
 * trusted devices, so a locked-out staff member can sign in (with their
 * password) and re-enrol. Gated by the same sensitive-action verification as
 * password reset, and audited.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const rawBody = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, rawBody?.security);

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, twoFactorEnabled: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorMethod: null, totpSecret: null, twoFactorBackupCodes: null },
      }),
      db.trustedDevice.deleteMany({ where: { userId: user.id } }),
    ]);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "RESET_USER_2FA",
        entity: "User",
        entityId: user.id,
        after: { wasEnabled: user.twoFactorEnabled } as any,
      },
    });

    // Best-effort heads-up to the user that their 2FA was reset by an admin.
    if (user.twoFactorEnabled) {
      await sendEmail({
        to: user.email,
        subject: "Two-step verification was reset",
        html: `<p>Hi ${user.name || "there"},</p><p>An administrator turned off two-step verification on your sNeek account. You can sign in with your password, then set 2FA up again from your profile. If this wasn't expected, contact your administrator.</p>`,
        transactional: true,
        // Security notice about a 2FA reset — must never be silenced by audience controls.
        critical: true,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, wasEnabled: user.twoFactorEnabled });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message ?? "Could not reset 2FA." }, { status });
  }
}
