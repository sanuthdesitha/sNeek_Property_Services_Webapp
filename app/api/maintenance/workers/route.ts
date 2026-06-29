import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireSession, requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listMaintenanceWorkers, createMaintenanceWorker } from "@/lib/maintenance/workers";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { upsertUserExtendedProfile } from "@/lib/accounts/user-details";
import { buildInvitationUrl, createUserInvitation, sendInvitationEmail } from "@/lib/auth/invitations";

export const dynamic = "force-dynamic";

/**
 * Assignable maintenance workers, safe projection (id/name/trade/company only).
 * Any authenticated portal user can read this so a client can pick a worker for
 * their own item; no contact details or internal notes are exposed.
 */
export async function GET() {
  try {
    await requireSession();
    const workers = await listMaintenanceWorkers({ activeOnly: true });
    const safe = workers.map((w: any) => ({
      id: w.id,
      name: w.name,
      trade: w.trade ?? null,
      company: w.company ?? null,
      isPermanent: Boolean(w.isPermanent),
    }));
    return NextResponse.json({ workers: safe });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  trade: z.string().trim().max(80).optional(),
  company: z.string().trim().max(120).optional(),
  /** When true (and an email is given), also mint a MAINTENANCE portal login
   *  and email a set-password invite — same secure flow as the admin "promote". */
  invite: z.boolean().optional(),
});

/**
 * Create a maintenance person — clients (and admin/ops) can add one and, if
 * requested, invite them to the maintenance portal. The portal login is created
 * with a random password; the worker sets their own via the emailed invite link
 * (we never set or handle their password), exactly like the admin promote flow.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT, Role.ADMIN, Role.OPS_MANAGER]);
    const body = postSchema.parse(await req.json());
    const email = body.email?.trim().toLowerCase() || undefined;

    if (body.invite && !email) {
      return NextResponse.json({ error: "Add an email to invite them to the portal." }, { status: 400 });
    }
    if (body.invite && email) {
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }

    const worker = await createMaintenanceWorker({
      name: body.name,
      email,
      phone: body.phone,
      trade: body.trade,
      company: body.company,
      createdById: session.user.id,
    });

    let invitationEmailSent = false;
    let invitationLink: string | undefined;
    let portalUserId: string | undefined;

    if (body.invite && email) {
      const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      const created = await db.user.create({
        data: {
          name: body.name,
          email,
          passwordHash,
          role: Role.MAINTENANCE,
          phone: body.phone || undefined,
          isActive: true,
          emailVerified: null,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      await upsertUserExtendedProfile(created.id, {
        jobTitle: body.trade ?? null,
        businessName: body.company ?? null,
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
      portalUserId = created.id;
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
          after: { email: created.email, role: created.role, source: "CLIENT_MAINTENANCE_WORKER_INVITE" } as any,
        },
      });
    }

    return NextResponse.json({ ok: true, workerId: worker.id, portalUserId, invitationEmailSent, invitationLink });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
