import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { upsertUserExtendedProfile } from "@/lib/accounts/user-details";
import { buildInvitationUrl, createUserInvitation, sendInvitationEmail } from "@/lib/auth/invitations";

/**
 * One-click: turn an ad-hoc maintenance worker into a permanent portal user
 * (role MAINTENANCE). Mints the User, links it to the worker, and emails an
 * invitation so they set their own password. Idempotent-ish: refuses if the
 * worker already has a linked user or the email is taken.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const worker = await db.maintenanceWorker.findUnique({ where: { id: params.id } });
    if (!worker) return NextResponse.json({ error: "Worker not found." }, { status: 404 });
    if (worker.userId) return NextResponse.json({ error: "This worker already has a portal login." }, { status: 409 });
    const email = worker.email?.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Add an email to this worker before creating a login." }, { status: 400 });

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "That email is already registered." }, { status: 409 });

    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const created = await db.user.create({
      data: {
        name: worker.name,
        email,
        passwordHash,
        role: Role.MAINTENANCE,
        phone: worker.phone || undefined,
        isActive: true,
        emailVerified: null,
      },
      select: { id: true, name: true, email: true, role: true },
    });

    await upsertUserExtendedProfile(created.id, {
      jobTitle: worker.trade ?? null,
      businessName: worker.company ?? null,
    });
    await upsertAuthUserState(created.id, {
      requiresOnboarding: true,
      tutorialSeen: false,
      requiresPasswordReset: false,
      welcomeEmailSent: false,
    });

    await db.maintenanceWorker.update({
      where: { id: worker.id },
      data: { userId: created.id, isPermanent: true },
    });

    let invitationEmailSent = false;
    let invitationLink: string | undefined;
    try {
      const invite = await createUserInvitation({ userId: created.id, createdById: session.user.id });
      invitationLink = buildInvitationUrl(invite.token);
      const emailResult = await sendInvitationEmail({
        to: created.email,
        name: created.name,
        role: created.role,
        url: invitationLink,
        expiresAt: invite.expiresAt,
      });
      invitationEmailSent = emailResult.ok;
    } catch {
      invitationEmailSent = false;
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE_USER",
        entity: "User",
        entityId: created.id,
        after: { email: created.email, role: created.role, source: "MAINTENANCE_WORKER_PROMOTE" } as any,
      },
    });

    return NextResponse.json({ ok: true, userId: created.id, invitationEmailSent, invitationLink });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
