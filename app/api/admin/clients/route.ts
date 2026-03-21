import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createClientSchema } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveAppUrl } from "@/lib/app-url";
import { upsertAuthUserState } from "@/lib/auth/account-state";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";

    const clients = await db.client.findMany({
      where: q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
        : {},
      include: { _count: { select: { properties: true } } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(clients);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createClientSchema.parse(await req.json());
    const sendPortalInvite = body.sendPortalInvite === true;
    const welcomeNote = body.welcomeNote?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() || "";

    if (sendPortalInvite && !email) {
      return NextResponse.json(
        { error: "Client email is required to send a portal invite." },
        { status: 400 }
      );
    }

    if (sendPortalInvite && email) {
      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true, role: true, clientId: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: "A user account already exists with this email. Link or update that user instead." },
          { status: 409 }
        );
      }
    }

    const tempPassword = sendPortalInvite ? generateTempPassword() : null;
    const passwordHash = tempPassword ? await bcrypt.hash(tempPassword, 10) : null;

    const result = await db.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          name: body.name,
          email: email || undefined,
          phone: body.phone || undefined,
          address: body.address || undefined,
          notes: body.notes || undefined,
        },
      });

      let invitedUser:
        | {
            id: string;
            name: string | null;
            email: string;
            role: Role;
          }
        | null = null;

      if (sendPortalInvite && email && passwordHash) {
        invitedUser = await tx.user.create({
          data: {
            name: body.name,
            email,
            role: Role.CLIENT,
            phone: body.phone || undefined,
            clientId: client.id,
            isActive: true,
            emailVerified: new Date(),
            passwordHash,
          },
          select: { id: true, name: true, email: true, role: true },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: sendPortalInvite ? "CREATE_CLIENT_WITH_INVITE" : "CREATE_CLIENT",
          entity: "Client",
          entityId: client.id,
          after: {
            email: email || null,
            invited: sendPortalInvite,
            invitedUserId: invitedUser?.id ?? null,
          } as any,
        },
      });

      return { client, invitedUser };
    });

    let warning: string | undefined;
    if (result.invitedUser && tempPassword) {
      await upsertAuthUserState(result.invitedUser.id, {
        requiresOnboarding: true,
        requiresPasswordReset: true,
        tutorialSeen: false,
        welcomeEmailSent: false,
      });

      const settings = await getAppSettings();
      const template = renderEmailTemplate(settings, "welcomeAccount", {
        userName: result.invitedUser.name ?? result.invitedUser.email,
        role: "CLIENT",
        email: result.invitedUser.email,
        tempPassword,
        welcomeNote,
        actionUrl: resolveAppUrl("/login", req),
        actionLabel: "Sign in and complete setup",
      });
      const emailResult = await sendEmailDetailed({
        to: result.invitedUser.email,
        subject: template.subject,
        html: template.html,
      });
      if (emailResult.ok) {
        await upsertAuthUserState(result.invitedUser.id, { welcomeEmailSent: true });
      } else {
        warning =
          emailResult.error ??
          "Client was created and invited, but the invite email could not be delivered.";
      }
    }

    return NextResponse.json(
      {
        ...result.client,
        invitedUserId: result.invitedUser?.id ?? null,
        invited: Boolean(result.invitedUser),
        warning,
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
