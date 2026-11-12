import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { parseVaPermissions, parseVaPropertyScope } from "./permissions";
import { MOVE_REFUSAL_TEXT, moveAccessChange, moveRefusal, type MoveRefusalCode, type MoveTeamFacts } from "./move-rules";

/**
 * Move a VA login to another team of the SAME client (owner decision
 * 2026-11-13), in one transaction.
 *
 * Access follows the team on the next request: `requireClientPortal` and
 * `resolvePortalScopeForUser` re-read `User.vaTeamId` and the team's grants
 * and scope from the database on every call (nothing is cached in the session
 * token), so the old team's grants stop applying from the person's next
 * request. The invitation, password and sign-in state are untouched.
 *
 * Refused: a login that is not an assistant on a team (404), a team that does
 * not exist (404), the same team, a team of another client, and a switched-off
 * destination unless `confirmInactive` (409, with the reason). Audited
 * `MOVE_VA_MEMBER` with the before and after team, their grants and scope, the
 * actual actor, their role and the impersonator if any.
 */

export class VaMoveRefused extends Error {
  constructor(readonly code: MoveRefusalCode) {
    super(MOVE_REFUSAL_TEXT[code]);
  }
}

export const MOVE_VA_MEMBER_AUDIT_ACTION = "MOVE_VA_MEMBER";

const TEAM_SELECT = { id: true, name: true, clientId: true, isActive: true, permissions: true, propertyIds: true } as const;

type TeamRow = Prisma.VaTeamGetPayload<{ select: typeof TEAM_SELECT }>;

function teamFacts(team: TeamRow): MoveTeamFacts {
  return {
    id: team.id,
    name: team.name,
    clientId: team.clientId,
    isActive: team.isActive,
    permissions: parseVaPermissions(team.permissions),
    propertyIds: parseVaPropertyScope(team.propertyIds),
  };
}

export type VaMoveActor = { id: string; role: string; impersonatedBy: string | null };

export type VaMoveResult = {
  userId: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  loses: string[];
  gains: string[];
  scope: string | null;
};

export async function moveVaMember(input: { userId: string; toTeamId: string; confirmInactive: boolean; actor: VaMoveActor }): Promise<VaMoveResult> {
  return db.$transaction(async (tx) => {
    // Lock the login so two moves (or a move and a removal) cannot interleave.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const member = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, vaTeamId: true } });
    if (!member || member.role !== Role.VA || !member.vaTeamId) throw new Error("MEMBER_NOT_FOUND");
    const [fromRow, toRow] = await Promise.all([
      tx.vaTeam.findUnique({ where: { id: member.vaTeamId }, select: TEAM_SELECT }),
      tx.vaTeam.findUnique({ where: { id: input.toTeamId }, select: TEAM_SELECT }),
    ]);
    if (!fromRow) throw new Error("MEMBER_NOT_FOUND");
    if (!toRow) throw new Error("TEAM_NOT_FOUND");
    const from = teamFacts(fromRow);
    const to = teamFacts(toRow);
    const refusal = moveRefusal(from, to, input.confirmInactive);
    if (refusal) throw new VaMoveRefused(refusal);

    const properties = await tx.property.findMany({ where: { clientId: from.clientId }, select: { id: true, name: true } });
    const change = moveAccessChange(from, to, new Map(properties.map((property) => [property.id, property.name])));

    // Conditional on the team read above, so a concurrent change is refused rather than overwritten.
    const moved = await tx.user.updateMany({ where: { id: member.id, role: Role.VA, vaTeamId: from.id }, data: { vaTeamId: to.id } });
    if (moved.count !== 1) throw new Error("MEMBER_NOT_FOUND");

    const snapshot = (team: MoveTeamFacts) => ({ teamId: team.id, teamName: team.name, isActive: team.isActive, permissions: team.permissions, propertyIds: team.propertyIds });
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: MOVE_VA_MEMBER_AUDIT_ACTION,
        entity: "User",
        entityId: member.id,
        before: snapshot(from) as Prisma.InputJsonValue,
        after: {
          ...snapshot(to),
          clientId: to.clientId,
          actorRole: input.actor.role,
          impersonatedBy: input.actor.impersonatedBy,
          confirmedInactive: !to.isActive,
          loses: change.loses,
          gains: change.gains,
          scope: change.scope,
        } as Prisma.InputJsonValue,
      },
    });
    return { userId: member.id, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name }, ...change };
  });
}
