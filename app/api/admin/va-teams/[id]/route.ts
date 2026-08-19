import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateVaTeam, deleteVaTeam, vaTeamUpdateSchema } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

/**
 * Admin-side management of an assistant team that already exists.
 *
 * The client owns these grants and manages them from /v2/client/team. Admin
 * needs the same reach for the ordinary reason support always does: the client
 * rings up, cannot find the toggle, and wants the change made now.
 *
 * The clientId is resolved from the TEAM, never from the request body — an
 * admin cannot be tricked into re-pointing a team at another client, and
 * updateVaTeam's own ownership check (properties must belong to that client)
 * then holds automatically.
 *
 * Same helpers as the client route on purpose. A second implementation is how
 * one rule becomes two that drift.
 */

async function resolveTeamClientId(teamId: string): Promise<string | null> {
  const team = await db.vaTeam.findUnique({
    where: { id: teamId },
    select: { clientId: true },
  });
  return team?.clientId ?? null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const teamId = params.id;

    const clientId = await resolveTeamClientId(teamId);
    if (!clientId) {
      return NextResponse.json({ error: "That assistant team no longer exists." }, { status: 404 });
    }

    const parsed = vaTeamUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid change." },
        { status: 400 }
      );
    }

    const team = await updateVaTeam({ clientId, teamId, ...parsed.data });

    // Recorded with the clientId, because the person who most needs to see that
    // an admin changed their assistants' access is the client.
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE_VA_TEAM",
        entity: "VaTeam",
        entityId: teamId,
        after: { clientId, ...parsed.data } as any,
      },
    });

    return NextResponse.json(team);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not update the team." },
      { status: vaTeamErrorStatus(err) }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const teamId = params.id;

    const clientId = await resolveTeamClientId(teamId);
    if (!clientId) {
      return NextResponse.json({ error: "That assistant team no longer exists." }, { status: 404 });
    }

    // deleteVaTeam deactivates the members first — the VaTeamMembers relation
    // is ON DELETE SET NULL, so dropping the team alone would leave working
    // logins behind with no team to resolve.
    await deleteVaTeam({ clientId, teamId });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELETE_VA_TEAM",
        entity: "VaTeam",
        entityId: teamId,
        after: { clientId } as any,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not remove the team." },
      { status: vaTeamErrorStatus(err) }
    );
  }
}
