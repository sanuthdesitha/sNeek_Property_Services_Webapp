import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { verifySensitiveAction } from "@/lib/security/admin-verification";

const inviteSchema = z.object({
  welcomeNote: z.string().trim().max(4000).optional(),
  security: z
    .object({
      pin: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = inviteSchema.parse(await req.json().catch(() => ({})));
    await verifySensitiveAction(session.user.id, body.security);

    const client = await db.client.findUnique({
      where: { id: params.id },
      include: {
        users: {
          where: { role: Role.CLIENT },
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true, name: true, role: true },
        },
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const email = client.email?.trim().toLowerCase() ?? "";
    if (!email) {
      return NextResponse.json({ error: "Client email is required before sending an invitation." }, { status: 400 });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const targetUser = await db.$transaction(async (tx) => {
      const existingLinked = await tx.user.findFirst({
        where: { clientId: client.id, role: Role.CLIENT },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, clientId: true, email: true, name: true },
      });
      const emailUser = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, clientId: true, email: true, name: true },
      });

      if (emailUser && existingLinked && emailUser.id !== existingLinked.id) {
        throw new Error("Another account already uses this email. Update or remove that account before sending the invite.");
      }

      if (emailUser && emailUser.role !== Role.CLIENT) {
        throw new Error("Another non-client account already uses this email.");
      }

      const targetAccount = emailUser ?? existingLinked;

      let nextUser;
      if (targetAccount) {
        nextUser = await tx.user.update({
          where: { id: targetAccount.id },
          data: {
            name: client.name,
            email,
            phone: client.phone || undefined,
            clientId: client.id,
            role: Role.CLIENT,
            isActive: true,
            emailVerified: new Date(),
            passwordHash,
          },
          select: { id: true, name: true, email: true, role: true },
        });
      } else {
        nextUser = await tx.user.create({
          data: {
            name: client.name,
            email,
            role: Role.CLIENT,
            phone: client.phone || undefined,
            clientId: client.id,
            isActive: true,
            emailVerified: new Date(),
            passwordHash,
          },
          select: { id: true, name: true, email: true, role: true },
        });
      }

      await tx.session.deleteMany({ where: { userId: nextUser.id } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "SEND_CLIENT_INVITE",
          entity: "Client",
          entityId: client.id,
          after: {
            userId: nextUser.id,
            email,
          } as any,
        },
      });

      return nextUser;
    });

    await upsertAuthUserState(targetUser.id, {
      requiresOnboarding: true,
      requiresPasswordReset: true,
      tutorialSeen: false,
      welcomeEmailSent: false,
      profileCreationNotified: false,
    });

    const settings = await getAppSettings();
    const template = renderEmailTemplate(settings, "accountInvite", {
      userName: targetUser.name ?? targetUser.email,
      role: "CLIENT",
      email: targetUser.email,
      tempPassword,
      welcomeNote: body.welcomeNote ?? "",
      actionUrl: resolveAppUrl("/login", req),
      actionLabel: "Sign in and set your password",
    });
    const emailResult = await sendEmailDetailed({
      to: targetUser.email,
      subject: template.subject,
      html: template.html,
    });
    if (emailResult.ok) {
      await upsertAuthUserState(targetUser.id, { welcomeEmailSent: true });
    }

    return NextResponse.json({
      ok: true,
      userId: targetUser.id,
      emailed: emailResult.ok,
      warning: emailResult.ok ? undefined : emailResult.error ?? "Invite email could not be delivered.",
      tempPassword: emailResult.ok ? undefined : tempPassword,
    });
  } catch (err: any) {
    const prismaCode = err?.code ?? err?.cause?.code;
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : prismaCode === "P2002"
              ? 409
            : 400;
    const message =
      prismaCode === "P2002"
        ? "Another account already uses this email. Use a different client email or update the conflicting account first."
        : err.message ?? "Could not send client invite.";
    return NextResponse.json({ error: message }, { status });
  }
}
