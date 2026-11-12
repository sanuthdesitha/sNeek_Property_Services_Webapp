import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { policyChanges } from "./access-diff";
import { getOpsPolicy } from "./ops-access";
import { opsPolicySchema, type OpsPolicy } from "./ops-policy";
import type { AccessHistoryEntry, AccessPerson, AccessScreenData, AccessViewer, AssistantTeam } from "./access-screen-types";

const OWN_PORTAL_ROLES: Role[] = [Role.CLEANER, Role.QA_INSPECTOR, Role.LAUNDRY, Role.MAINTENANCE];
const HISTORY_ROWS = 100;

/** Active people with office access: administrators and anyone holding OPS_MANAGER. */
async function officePeople(): Promise<AccessPerson[]> {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
        { extraRoles: { some: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] } } } },
      ],
    },
    select: { id: true, name: true, email: true, role: true, twoFactorEnabled: true, createdAt: true, extraRoles: { select: { role: true } } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    heldRoles: [row.role, ...row.extraRoles.map((extra) => extra.role).filter((role) => role !== row.role)],
    twoFactorEnabled: row.twoFactorEnabled,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** People whose only access is their own portal (no office role), counted by role. */
async function ownPortalCounts(): Promise<Record<string, number>> {
  const groups = await db.user.groupBy({
    by: ["role"],
    where: {
      isActive: true,
      role: { in: OWN_PORTAL_ROLES },
      extraRoles: { none: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] } } },
    },
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((group) => [group.role, group._count._all]));
}

async function assistantTeams(): Promise<AssistantTeam[]> {
  const teams = await db.vaTeam.findMany({
    select: { id: true, name: true, isActive: true, clientId: true, client: { select: { name: true } }, _count: { select: { members: true } } },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    clientId: team.clientId,
    clientName: team.client.name,
    memberCount: team._count.members,
    isActive: team.isActive,
  }));
}

/** Lenient read of a stored audit policy; an unreadable row yields no lines rather than failing the screen. */
function storedPolicy(value: unknown): OpsPolicy | null {
  if (!value || typeof value !== "object") return null;
  const { audit: _audit, ...policy } = value as Record<string, unknown>;
  const parsed = opsPolicySchema.safeParse(policy);
  return parsed.success ? parsed.data : null;
}

/** Saved access changes, newest first, as plain-language lines per person or preset. */
export async function accessHistory(): Promise<AccessHistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { action: "OPS_PERMISSIONS_UPDATED" },
    orderBy: { createdAt: "desc" },
    take: HISTORY_ROWS,
    select: { id: true, createdAt: true, userId: true, before: true, after: true, user: { select: { name: true, email: true } } },
  });
  return rows.flatMap((row) => {
    const before = storedPolicy(row.before);
    const after = storedPolicy(row.after);
    if (!before || !after) return [];
    return policyChanges(before, after).map((change, index) => ({
      id: `${row.id}:${index}`,
      at: row.createdAt.toISOString(),
      actorId: row.userId,
      actorName: row.user?.name || row.user?.email || "Someone",
      subjectId: change.subject.kind === "person" ? change.subject.id : `preset:${change.subject.id}`,
      text: change.text,
    }));
  });
}

export async function loadAccessScreen(viewer: AccessViewer): Promise<AccessScreenData> {
  const [policy, people, counts, teams, history, settings] = await Promise.all([
    getOpsPolicy(),
    officePeople(),
    ownPortalCounts(),
    assistantTeams(),
    accessHistory(),
    getAppSettings(),
  ]);
  return { policy, people, ownPortalCounts: counts, assistantTeams: teams, history, viewer, timeZone: settings.timezone };
}
