import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { issueRecoveryToken } from "@/lib/auth/recovery";
import { passwordResetEmail, passwordResetLink } from "@/lib/auth/password-reset-email";
import { verifySensitiveAction, isSensitiveRefusal } from "@/lib/security/admin-verification";
import { DelegatedActionDenied, requireDelegatedAction } from "@/lib/rbac/delegated-admin";

/** At most this many administrator resets for one person in the window (counted from the audit log, so every server instance agrees). */
const ADMIN_RESET_LIMIT = { limit: 3, windowMinutes: 15 };

/**
 * Administrator password reset (2026-11-16: a one-time link, no longer an
 * emailed temporary password). The account is secured exactly as before: the
 * old password stops working, sessions and remembered devices are removed and
 * the next sign-in must set a new password. The person gets a single-use link
 * that expires in 30 minutes (hashed token, lib/auth/recovery.ts; the same
 * link as "Forgot password"). Rate limited per person, PIN-confirmed and
 * audited. The response keeps its shape: when the email could not be sent, a
 * temporary password is set and returned once so the administrator can share
 * it by hand (the previous fallback), and nobody is locked out.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // ADMIN, or a person an administrator granted "accounts.reset_password" (owner decision
    // 2026-11-12): never on an administrator, on someone with more access,
    // on themselves, or while testing as someone (lib/rbac/delegated-admin.ts).
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireDelegatedAction(session, "accounts.reset_password", params.id);
    const rawBody = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, rawBody?.security);
    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const since = new Date(Date.now() - ADMIN_RESET_LIMIT.windowMinutes * 60_000);
    const recent = await db.auditLog.count({ where: { action: "RESET_USER_PASSWORD", entity: "User", entityId: user.id, createdAt: { gte: since } } });
    if (recent >= ADMIN_RESET_LIMIT.limit) {
      return NextResponse.json({ error: `This person's password was reset ${recent} times in the last ${ADMIN_RESET_LIMIT.windowMinutes} minutes. Wait before sending another link.` }, { status: 429 });
    }

    // The old password stops working at once; only the link (or the fallback below) can set a new one.
    const unusableHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: unusableHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      // Also drop any "remember this device" 2FA tokens so a reset (often done
      // for a compromised account) can't be bypassed by a still-trusted device.
      await tx.trustedDevice.deleteMany({ where: { userId: user.id } });
    });
    await upsertAuthUserState(user.id, { requiresPasswordReset: true });

    const to = user.email.toLowerCase();
    // Issuing replaces any earlier reset link for this address (single use, 30 minutes).
    const rawToken = await issueRecoveryToken("pwreset", to);
    const settings = await getAppSettings();
    const content = passwordResetEmail({ name: user.name, email: to, link: passwordResetLink(to, rawToken), reason: "administrator", settings });
    const emailResult = await sendEmailDetailed({
      to,
      subject: content.subject,
      html: content.html,
      transactional: true,
      // Account recovery: must never be silenced by audience controls.
      critical: true,
    });

    let tempPassword: string | undefined;
    if (!emailResult.ok) {
      tempPassword = generateTempPassword();
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(tempPassword, 10) } });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "RESET_USER_PASSWORD",
        entity: "User",
        entityId: user.id,
        after: {
          actorRole: actor.role,
          mode: tempPassword ? "TEMPORARY_PASSWORD_FALLBACK" : "RESET_LINK",
          emailSent: emailResult.ok,
          emailAcceptance: emailResult.acceptance ?? null,
          wasActive: user.isActive,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      emailed: emailResult.ok,
      mode: tempPassword ? "TEMPORARY_PASSWORD_FALLBACK" : "RESET_LINK",
      warning: emailResult.ok ? undefined : `${emailResult.error ?? "The email was not sent."} A temporary password was set instead; share it with the person yourself.`,
      tempPassword,
    });
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
    return NextResponse.json({ error: err.message ?? "Password reset failed." }, { status });
  }
}
