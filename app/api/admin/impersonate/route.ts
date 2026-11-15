import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRealSession } from "@/lib/auth/session";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_AGE_SECONDS,
  TEST_AS_ENDED_COOKIE,
  TEST_AS_ENDED_MAX_AGE_SECONDS,
  impersonationCookieOptions,
  impersonationEndsAt,
  readImpersonationTicket,
  readTestAsEndedMarker,
  signImpersonationTicket,
  signTestAsEndedMarker,
} from "@/lib/auth/impersonation";
import { sendTestedAsNotice, startAuditIdFor } from "@/lib/auth/tested-as-notice";
import { TEST_AS_UNLOCK_COOKIE, isTestAsUnlocked } from "@/lib/auth/test-as-unlock";
import { delegatedTestAsAllowed, realActorHolds } from "@/lib/rbac/delegated-admin";

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
  // Owner decision 2026-11-12: an administrator may grant "Test as" to a
  // person; they may only test as someone with no more access than them
  // (re-checked below and on every request in impersonation-server.ts).
  const isAdmin = session.user.role === Role.ADMIN;
  if (!isAdmin && !(await realActorHolds(session.user.id, "access.test_as"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Being an admin is not enough: the console is password-locked, and the lock
  // is enforced HERE as well as in the UI — a direct POST without a fresh
  // unlock (see POST /api/admin/test-as/unlock) is refused.
  if (!isTestAsUnlocked(request.cookies.get(TEST_AS_UNLOCK_COOKIE)?.value, session.user.id)) {
    return NextResponse.json(
      {
        error: "Confirm your password to start a test session.",
        code: "TEST_AS_LOCKED",
      },
      { status: 403 },
    );
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

  if (!isAdmin && !(await delegatedTestAsAllowed(session.user.id, target.id))) {
    return NextResponse.json(
      { error: "You can only test as someone with no more access than you." },
      { status: 403 },
    );
  }

  const startedAt = Date.now();

  // Audited BEFORE the cookie is handed over, so a crash can't produce an
  // un-recorded impersonation. `userId` is the audit actor column — the real
  // admin — and the entity is the account being viewed.
  const startAudit = await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "IMPERSONATE_START",
      entity: "User",
      entityId: target.id,
      after: {
        targetEmail: target.email,
        targetRole: target.role,
        actorRole: isAdmin ? "ADMIN" : "DELEGATED",
        mode,
        expiresInSeconds: IMPERSONATION_MAX_AGE_SECONDS,
      },
      ipAddress: clientIp(request),
    },
    select: { id: true },
  });

  const ticket = {
    actorId: session.user.id,
    actorEmail: session.user.email ?? "",
    targetId: target.id,
    targetRole: target.role,
    mode,
    startedAt,
    // Ties the stop, the "you were tested as" note and the log to this session.
    startAuditId: startAudit.id,
  };
  const token = await signImpersonationTicket(ticket);

  cookies().set(
    IMPERSONATION_COOKIE,
    token,
    impersonationCookieOptions(IMPERSONATION_MAX_AGE_SECONDS),
  );
  // Remembers the session past its hour, only to say "it ended after one
  // hour" to this administrator (board "Test as"). It grants nothing.
  cookies().set(
    TEST_AS_ENDED_COOKIE,
    await signTestAsEndedMarker({
      actorId: session.user.id,
      targetId: target.id,
      targetName: target.name || target.email || "that person",
      mode,
      startedAt,
      endsAt: impersonationEndsAt(ticket),
      startAuditId: startAudit.id,
    }),
    impersonationCookieOptions(TEST_AS_ENDED_MAX_AGE_SECONDS),
  );

  return NextResponse.json({
    ok: true,
    target: { id: target.id, name: target.name, email: target.email, role: target.role },
    mode,
    home: v2PortalHome(target.role),
    endsAt: new Date(impersonationEndsAt(ticket)).toISOString(),
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

  const marker = await readTestAsEndedMarker(request.cookies.get(TEST_AS_ENDED_COOKIE)?.value);

  // Always clear, even if the ticket was unreadable or belonged to someone
  // else — "stop" must never be able to leave you stuck.
  cookies().set(IMPERSONATION_COOKIE, "", impersonationCookieOptions(0));
  cookies().set(TEST_AS_ENDED_COOKIE, "", impersonationCookieOptions(0));

  if (existing && existing.actorId === session.user.id) {
    const stoppedAt = new Date();
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
    // Owner default (pending owner confirmation): the person is told once,
    // in their inbox, after a FULL access session only. A failure here never
    // keeps anyone in the test; the worker sweep tries again.
    if (existing.mode === "FULL") await notifyTestedPerson(existing, stoppedAt);
    return NextResponse.json({ ok: true, stopped: { targetId: existing.targetId, mode: existing.mode, startedAt: new Date(existing.startedAt).toISOString(), stoppedAt: stoppedAt.toISOString() } });
  }

  // The session already ended by itself (the hour passed): record that it
  // ended, once, and tell the person if it was full access.
  if (!existing && marker && marker.actorId === session.user.id && marker.endsAt <= Date.now()) {
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "IMPERSONATE_EXPIRED",
        entity: "User",
        entityId: marker.targetId,
        after: { mode: marker.mode, durationSeconds: IMPERSONATION_MAX_AGE_SECONDS, startAuditId: marker.startAuditId ?? null },
        ipAddress: clientIp(request),
      },
    });
    if (marker.mode === "FULL") {
      await notifyTestedPerson({ actorId: marker.actorId, targetId: marker.targetId, startedAt: marker.startedAt, startAuditId: marker.startAuditId }, new Date(marker.endsAt));
    }
  }

  return NextResponse.json({ ok: true });
}

async function notifyTestedPerson(
  session: { actorId: string; targetId: string; startedAt: number; startAuditId?: string },
  endedAt: Date,
): Promise<void> {
  try {
    const startAuditId = await startAuditIdFor(session);
    if (startAuditId) await sendTestedAsNotice({ startAuditId, endedAt });
  } catch {
    /* the worker sweep (test-as-notices) sends it later */
  }
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
