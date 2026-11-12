/**
 * People › Assistants: every client assistant team with its members, grants,
 * property scope and recent activity, for the grouped table and the team
 * panel. Grants and scope go through the SAME parsers the client-portal
 * chokepoint uses (lib/va/permissions), so the screen shows exactly what is
 * enforced. Read-only; changes go through the existing team routes.
 */
import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { parseVaPermissions, parseVaPropertyScope, VA_PERMISSION_KEYS, type VaPermissions } from "@/lib/va/permissions";

export type AssistantMemberStatus = "ACTIVE" | "INVITED" | "INVITE_EXPIRED" | "INVITE_REVOKED" | "SUSPENDED" | "TEAM_OFF";

export type AssistantMember = {
  id: string;
  name: string | null;
  email: string;
  status: AssistantMemberStatus;
  invitedAt: string | null;
  inviteExpiresAt: string | null;
  lastSeenAt: string | null;
};

export type AssistantActivity = { id: string; actorName: string; action: string; at: string };

export type AssistantTeam = {
  id: string;
  name: string;
  isActive: boolean;
  client: { id: string; name: string; propertyCount: number };
  createdAt: string;
  createdByName: string | null;
  permissions: VaPermissions;
  grantedCount: number;
  /** Null = every property of the client (new ones included automatically). */
  propertyIds: string[] | null;
  properties: Array<{ id: string; name: string }>;
  members: AssistantMember[];
  activity: AssistantActivity[];
};

export function memberStatus(member: { isActive: boolean; invitation: { acceptedAt: Date | null; expiresAt: Date; revokedAt?: Date | null } | null }, teamActive: boolean, now: Date): AssistantMemberStatus {
  if (!member.isActive) return "SUSPENDED";
  // Withdrawn by the office (owner decision 2026-11-13): a new invitation replaces it.
  if (member.invitation && !member.invitation.acceptedAt && member.invitation.revokedAt) return "INVITE_REVOKED";
  if (member.invitation && !member.invitation.acceptedAt) return member.invitation.expiresAt.getTime() <= now.getTime() ? "INVITE_EXPIRED" : "INVITED";
  return teamActive ? "ACTIVE" : "TEAM_OFF";
}

/** Plain-language labels for audit actions an assistant can take. */
function activityLabel(action: string): string {
  return action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export async function listAssistantTeams(now: Date = new Date()): Promise<AssistantTeam[]> {
  const teams = await db.vaTeam.findMany({
    orderBy: [{ client: { name: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true, name: true, isActive: true, permissions: true, propertyIds: true, createdAt: true,
      createdBy: { select: { name: true, email: true } },
      client: { select: { id: true, name: true, properties: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } } },
      members: {
        where: { role: Role.VA },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, isActive: true, lastSeenAt: true, invitation: { select: { acceptedAt: true, expiresAt: true, createdAt: true, revokedAt: true } } },
      },
    },
  });
  const memberIds = teams.flatMap((team) => team.members.map((member) => member.id));
  const audits = memberIds.length
    ? await db.auditLog.findMany({ where: { userId: { in: memberIds } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, userId: true, action: true, createdAt: true } })
    : [];
  return teams.map((team) => {
    const permissions = parseVaPermissions(team.permissions);
    const scope = parseVaPropertyScope(team.propertyIds);
    const names = new Map(team.members.map((member) => [member.id, member.name ?? member.email]));
    return {
      id: team.id,
      name: team.name,
      isActive: team.isActive,
      client: { id: team.client.id, name: team.client.name, propertyCount: team.client.properties.length },
      createdAt: team.createdAt.toISOString(),
      createdByName: team.createdBy ? team.createdBy.name?.trim() || team.createdBy.email : null,
      permissions,
      grantedCount: VA_PERMISSION_KEYS.filter((key) => permissions[key]).length,
      propertyIds: scope,
      properties: team.client.properties,
      members: team.members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        status: memberStatus(member, team.isActive, now),
        invitedAt: member.invitation?.createdAt.toISOString() ?? null,
        inviteExpiresAt: member.invitation && !member.invitation.acceptedAt && !member.invitation.revokedAt ? member.invitation.expiresAt.toISOString() : null,
        lastSeenAt: member.lastSeenAt?.toISOString() ?? null,
      })),
      activity: audits
        .filter((row) => row.userId && names.has(row.userId))
        .slice(0, 5)
        .map((row) => ({ id: row.id, actorName: names.get(row.userId ?? "") ?? "Assistant", action: activityLabel(row.action), at: row.createdAt.toISOString() })),
    };
  });
}
