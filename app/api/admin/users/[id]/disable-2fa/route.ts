import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { verifySensitiveAction, isSensitiveRefusal } from "@/lib/security/admin-verification";
import { DelegatedActionDenied, requireDelegatedAction } from "@/lib/rbac/delegated-admin";

/**
 * Admin-side 2FA reset: turn off a user's two-step verification and forget their
 * trusted devices, so a locked-out staff member can sign in (with their
 * password) and re-enrol. Gated by the same sensitive-action verification as
 * password reset, and audited.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // ADMIN, or a person an administrator granted "accounts.reset_two_step" (owner decision
    // 2026-11-12): never on an administrator, on someone with more access,
    // on themselves, or while testing as someone (lib/rbac/delegated-admin.ts).
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireDelegatedAction(session, "accounts.reset_two_step", params.id);
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
        after: {
          actorRole: actor.role,
          wasEnabled: user.twoFactorEnabled,
        } as any,
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
    if (err instanceof DelegatedActionDenied) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : isSensitiveRefusal(err)
            ? 423
            : 400;
    return NextResponse.json({ error: err.message ?? "Could not reset 2FA." }, { status });
  }
}
