import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { removeVaMember } from "@/lib/va/teams";
import { vaTeamErrorStatus } from "@/lib/va/http";
import { moveVaMember, VaMoveRefused } from "@/lib/va/move-member";

const moveSchema = z.object({ toTeamId: z.string().trim().min(1).max(64), confirmInactive: z.boolean().optional() }).strict();

/**
 * PATCH { toTeamId, confirmInactive? } — "Move to team…" (owner decision
 * 2026-11-13): move this assistant to another team of the SAME client, in one
 * transaction (lib/va/move-member.ts). Administrators only, like the
 * Assistants screen's other team changes (remove from team, delete team).
 * `[id]` must still be the assistant's team, so a stale screen is refused
 * rather than moving someone from a team they already left.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; userId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = moveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose the team to move the assistant to." }, { status: 400 });
    const member = await db.user.findUnique({ where: { id: params.userId }, select: { vaTeamId: true } });
    if (!member || member.vaTeamId !== params.id) {
      return NextResponse.json({ error: "This assistant is no longer on that team. Reload and check." }, { status: 409 });
    }
    const result = await moveVaMember({
      userId: params.userId,
      toTeamId: parsed.data.toTeamId,
      confirmInactive: parsed.data.confirmInactive === true,
      actor: { id: session.user.id, role: String(session.user.role), impersonatedBy: session.impersonation?.actorId ?? null },
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof VaMoveRefused) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    const message = err instanceof Error && err.message ? err.message : "Could not move the assistant.";
    return NextResponse.json({ error: message }, { status: vaTeamErrorStatus(err) });
  }
}

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
