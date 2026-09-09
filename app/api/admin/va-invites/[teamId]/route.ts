import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateVaTeam, deleteVaTeam, vaTeamUpdateSchema } from "@/lib/va/teams";
import { getValidationErrorMessage } from "@/lib/validations/errors";

/**
 * Admin-side management of ONE assistant team.
 *
 * The sibling route's stance — "grants belong to the client" — is about the
 * INVITE flow: adding a sixth assistant must not silently rewrite a team the
 * client may have deliberately narrowed. That still holds. This route is the
 * other thing entirely: the owner explicitly editing a team's permissions,
 * property scope, name or active state, which the client portal could already
 * do and the admin portal could not. An assistant's grants were therefore
 * EDITABLE ONLY BY THE CLIENT they act for — the admin who onboarded them had
 * no way to correct a mistake without asking the client to do it.
 *
 * Thin wrapper over lib/va/teams.ts, same as the sibling route and the client
 * portal — one implementation of the update rule, three doors to it. The
 * team's clientId is resolved HERE and passed down, so updateVaTeam's
 * ownership check stays intact rather than being special-cased for admins.
 *
 * Every change writes an AuditLog row against the ACTING ADMIN, with the
 * before-image of the fields being changed — these are permission changes, and
 * "who widened this team, when, from what" is exactly the question an audit
 * exists to answer.
 */

async function loadTeam(teamId: string) {
  return db.vaTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      clientId: true,
      name: true,
      permissions: true,
      propertyIds: true,
      isActive: true,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { teamId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);

    const team = await loadTeam(params.teamId);
    if (!team) {
      return NextResponse.json({ error: "Assistant team not found." }, { status: 404 });
    }

    const parsed = vaTeamUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid change." },
        { status: 400 }
      );
    }

    const updated = await updateVaTeam({
      clientId: team.clientId,
      teamId: team.id,
      ...parsed.data,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "va_team.admin_update",
        entity: "VaTeam",
        entityId: team.id,
        // Before-image of only the fields being changed, so the row answers
        // "what did it say before" without storing the whole team twice.
        before: Object.fromEntries(
          Object.keys(parsed.data).map((key) => [key, (team as Record<string, unknown>)[key]])
        ) as object,
        after: { ...parsed.data, clientId: team.clientId } as object,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: getValidationErrorMessage(err, "Could not update the team.") },
      { status }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { teamId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);

    const team = await loadTeam(params.teamId);
    if (!team) {
      return NextResponse.json({ error: "Assistant team not found." }, { status: 404 });
    }

    await deleteVaTeam({ clientId: team.clientId, teamId: team.id });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "va_team.admin_delete",
        entity: "VaTeam",
        entityId: team.id,
        before: {
          name: team.name,
          clientId: team.clientId,
          permissions: team.permissions,
          propertyIds: team.propertyIds,
        } as object,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: getValidationErrorMessage(err, "Could not remove the team.") },
      { status }
    );
  }
}
