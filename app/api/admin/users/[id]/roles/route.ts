import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { GRANTABLE_EXTRA_ROLES, ROLE_LABELS, isGrantableExtraRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * THE EXTRA HATS ON ONE ACCOUNT — granted and revoked here, nowhere else.
 *
 * ADMIN ONLY, deliberately narrower than the account screen that hosts it. The
 * rest of /v2/admin/accounts admits OPS_MANAGER, but this endpoint decides what
 * somebody may DO: `requireRole` is answered against every role a person holds,
 * so a row written here is a live permission across all 848 authorisation call
 * sites in the app. Handing that out is a security decision, not day-to-day ops.
 *
 *   POST   /api/admin/users/:id/roles   { role }   → grant
 *   DELETE /api/admin/users/:id/roles?role=CLEANER → revoke
 *
 * Both return the account's full extra-role list, so the screen never has to
 * guess at the result of its own write.
 */

interface ExtraRoleRow {
  role: Role;
  label: string;
  grantedAt: Date;
  grantedBy: { id: string; name: string | null; email: string | null } | null;
}

async function readExtraRoles(userId: string): Promise<ExtraRoleRow[]> {
  const rows = await db.userRole.findMany({
    where: { userId },
    orderBy: { grantedAt: "asc" },
    select: {
      role: true,
      grantedAt: true,
      grantedBy: { select: { id: true, name: true, email: true } },
    },
  });
  return rows.map((row) => ({
    role: row.role,
    label: ROLE_LABELS[row.role],
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy,
  }));
}

/** The role named in the request, or a 400-worthy reason it is not one. */
function parseRole(value: unknown): { ok: true; role: Role } | { ok: false; error: string } {
  if (typeof value !== "string" || !value) {
    return { ok: false, error: "Name the role." };
  }
  if (!(Object.values(Role) as string[]).includes(value)) {
    return { ok: false, error: `"${value}" is not a role.` };
  }
  return { ok: true, role: value as Role };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);

    const body = await req.json().catch(() => null);
    const parsed = parseRole((body as { role?: unknown } | null)?.role);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const role = parsed.role;

    // The refusal is the library's, and it is surfaced rather than worked
    // around: ADMIN and OPS_MANAGER as a secondary hat is a privilege-escalation
    // path, and CLIENT / VA are scoped to a particular client account rather
    // than granted generically.
    if (!isGrantableExtraRole(role)) {
      return NextResponse.json(
        {
          error:
            `${ROLE_LABELS[role]} cannot be given as an extra role. ` +
            `Only ${GRANTABLE_EXTRA_ROLES.map((r) => ROLE_LABELS[r]).join(", ")} can.`,
        },
        { status: 400 }
      );
    }

    const target = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // A CLIENT or VA account is a customer-side login. Giving one a staff hat
    // would put a client inside the cleaner or QA portal, where every job in the
    // business is visible — the account screen already hides clients, but the
    // API must refuse it on its own rather than trust that a UI never asks.
    if (target.role === Role.CLIENT || target.role === Role.VA) {
      return NextResponse.json(
        { error: "Client-side accounts cannot be given staff roles." },
        { status: 400 }
      );
    }

    // `heldRoles` already collapses a duplicate, so a row like this would change
    // nothing — but it would sit on the screen as a grant somebody made, and be
    // revocable, implying the person could lose a role that is actually their job.
    if (target.role === role) {
      return NextResponse.json(
        { error: `${ROLE_LABELS[role]} is already their primary role.` },
        { status: 400 }
      );
    }

    // ONE TRANSACTION, so a grant that could not be recorded does not stand. A
    // permission change nobody can trace back to who made it is exactly the
    // thing an audit log exists to prevent, and unlike a settings write there is
    // no partially-useful outcome here worth keeping.
    await db.$transaction(async (tx) => {
      const created = await tx.userRole.create({
        data: { userId: target.id, role, grantedById: session.user.id },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "GRANT_EXTRA_ROLE",
          // Filed against the User, not the UserRole row: this is the account
          // whose activity timeline an admin will go looking through, and the
          // row itself is gone once the role is revoked.
          entity: "User",
          entityId: target.id,
          after: { role, primaryRole: target.role, userRoleId: created.id },
        },
      });
    });

    return NextResponse.json({ extraRoles: await readExtraRoles(target.id) }, { status: 201 });
  } catch (err: any) {
    // The @@unique([userId, role]) collision. Two admins on the same screen is
    // not an error worth a 500 — the end state they both wanted already exists.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "They already have that role.", extraRoles: await readExtraRoles(params.id) },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: err?.message ?? "Could not grant the role." },
      { status: statusFor(err?.message) }
    );
  }
}

/**
 * Take a hat back.
 *
 * NOTHING NEEDS TO CLEAR THEIR ACTIVE-ROLE COOKIE. It carries a role name and no
 * authority: `resolveActiveRole` checks it against what the database says they
 * hold on every request and falls back to their primary the moment this row is
 * gone. A revoked inspector is out of the QA portal on their next page load.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);

    const parsed = parseRole(req.nextUrl.searchParams.get("role"));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const role = parsed.role;

    const existing = await db.userRole.findUnique({
      where: { userId_role: { userId: params.id, role } },
      select: { id: true, grantedAt: true, grantedById: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "They do not have that extra role." }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REVOKE_EXTRA_ROLE",
          entity: "User",
          entityId: params.id,
          // The whole row, because after this call there is nothing left to look
          // it up from — who granted it and when only survive here.
          before: {
            role,
            userRoleId: existing.id,
            grantedAt: existing.grantedAt.toISOString(),
            grantedById: existing.grantedById,
          },
        },
      });
    });

    return NextResponse.json({ extraRoles: await readExtraRoles(params.id) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not revoke the role." },
      { status: statusFor(err?.message) }
    );
  }
}

function statusFor(message: string | undefined): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}
