import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { removeVaMember } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";

/**
 * Admin removes one assistant from a team.
 *
 * removeVaMember does two writes and both matter: clearing `vaTeamId` makes the
 * auth chokepoint fail closed for them, and `isActive: false` stops the
 * credential signing in at all. Without the second, a removed assistant still
 * holds a working login that merely resolves to no client.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const team = await db.vaTeam.findUnique({
      where: { id: params.id },
      select: { clientId: true },
    });
    if (!team) {
      return NextResponse.json({ error: "That assistant team no longer exists." }, { status: 404 });
    }

    await removeVaMember({ clientId: team.clientId, teamId: params.id, userId: params.userId });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REMOVE_VA_MEMBER",
        entity: "VaTeam",
        entityId: params.id,
        after: { clientId: team.clientId, removedUserId: params.userId } as any,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not remove the assistant." },
      { status: vaTeamErrorStatus(err) }
    );
  }
}
