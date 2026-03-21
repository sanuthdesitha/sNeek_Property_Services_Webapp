import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { resolveAppUrl } from "@/lib/app-url";
import { generateTempPassword } from "@/lib/auth/temp-password";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
    });
    await upsertAuthUserState(user.id, { requiresPasswordReset: true });

    const settings = await getAppSettings();
    const emailTemplate = renderEmailTemplate(settings, "resetPassword", {
      userName: user.name ?? "there",
      tempPassword,
      email: user.email,
      actionUrl: resolveAppUrl("/login", req),
      actionLabel: "Sign in now",
    });
    const emailResult = await sendEmailDetailed({
      to: user.email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "RESET_USER_PASSWORD",
        entity: "User",
        entityId: user.id,
        after: {
          emailSent: emailResult.ok,
          wasActive: user.isActive,
        } as any,
      },
    });

    return NextResponse.json({
      ok: true,
      emailed: emailResult.ok,
      warning: emailResult.ok ? undefined : emailResult.error ?? "Email failed. Share the temporary password manually.",
      tempPassword: emailResult.ok ? undefined : tempPassword,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Password reset failed." }, { status });
  }
}
