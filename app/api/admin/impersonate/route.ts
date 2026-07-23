import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRealSession } from "@/lib/auth/session";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_AGE_SECONDS,
  impersonationCookieOptions,
  readImpersonationTicket,
  signImpersonationTicket,
} from "@/lib/auth/impersonation";

/**
 * Start / stop an admin "test as" session.
 *
 * Deliberately NOT gated with requireRole(): while impersonating, the session's
 * role IS the target's, so an ADMIN check against the impersonated session
 * would lock the admin inside the cleaner portal with no way out. Both handlers
 * therefore authorise against `requireRealSession()` — the human at the
 * keyboard — which is also the correct actor to record in the audit log.
 */

const startSchema = z.object({
  userId: z.string().min(1),
  mode: z.enum(["READ_ONLY", "FULL"]).default("READ_ONLY"),
});

function clientIp(request: NextRequest): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireRealSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ADMIN only — not OPS_MANAGER. Impersonation grants whatever the target can
  // do; handing it to a second, broader role widens the blast radius for no
  // testing benefit.
  if (session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const { userId, mode } = parsed.data;

  if (userId === session.user.id) {
    return NextResponse.json({ error: "You are already yourself." }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!target.isActive) {
    return NextResponse.json(
      { error: "That account is deactivated — reactivate it first." },
      { status: 400 },
    );
  }
  // Cannot become another admin: this tool is for seeing the non-admin portals,
  // and admin→admin would let one admin act as another with no way to tell them
  // apart afterwards.
  if (target.role === Role.ADMIN) {
    return NextResponse.json(
      { error: "Cannot test as another admin account." },
      { status: 400 },
    );
  }

  const ticket = {
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    targetId: target.id,
    targetRole: target.role,
    mode,
    startedAt: Date.now(),
  };
  const token = await signImpersonationTicket(ticket);

  // Audited BEFORE the cookie is handed over, so a crash can't produce an
  // un-recorded impersonation. `userId` is the audit actor column — the real
  // admin — and the entity is the account being viewed.
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "IMPERSONATE_START",
      entity: "User",
      entityId: target.id,
      after: {
        targetEmail: target.email,
        targetRole: target.role,
        mode,
        expiresInSeconds: IMPERSONATION_MAX_AGE_SECONDS,
      },
      ipAddress: clientIp(request),
    },
  });

  cookies().set(
    IMPERSONATION_COOKIE,
    token,
    impersonationCookieOptions(IMPERSONATION_MAX_AGE_SECONDS),
  );

  return NextResponse.json({
    ok: true,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
    mode,
    home: v2PortalHome(target.role),
  });
}

export async function DELETE(request: NextRequest) {
  let session;
  try {
    session = await requireRealSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await readImpersonationTicket(
    request.cookies.get(IMPERSONATION_COOKIE)?.value,
  );

  // Always clear, even if the ticket was unreadable or belonged to someone
  // else — "stop" must never be able to leave you stuck.
  cookies().set(IMPERSONATION_COOKIE, "", impersonationCookieOptions(0));

  if (existing && existing.actorId === session.user.id) {
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "IMPERSONATE_STOP",
        entity: "User",
        entityId: existing.targetId,
        after: {
          mode: existing.mode,
          durationSeconds: Math.round((Date.now() - existing.startedAt) / 1000),
        },
        ipAddress: clientIp(request),
      },
    });
  }

  return NextResponse.json({ ok: true });
}

function v2PortalHome(role: Role): string {
  switch (role) {
    case Role.CLEANER:
      return "/v2/cleaner";
    case Role.CLIENT:
      return "/v2/client";
    case Role.LAUNDRY:
      return "/v2/laundry";
    case Role.QA_INSPECTOR:
      return "/v2/qa";
    case Role.MAINTENANCE:
      return "/v2/maintenance";
    default:
      return "/v2";
  }
}
