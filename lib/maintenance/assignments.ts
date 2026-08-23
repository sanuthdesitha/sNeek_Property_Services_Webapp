/**
 * CP-6 — data layer for multi-role maintenance assignment.
 *
 * The pure rules live in `./assignment-roles`; this module is the thin database
 * skin over them. Nothing here formats a date or sends an email — the API route
 * owns notification so a mail failure can be isolated from the write.
 *
 * Convention borrowed from JobAssignment: a row is never deleted. Un-assigning
 * stamps `removedAt`, re-assigning clears it, so the roster keeps its history.
 */
import { MaintenanceAssigneeRole, MaintenanceStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  MAINTENANCE_ASSIGNEE_ROLES,
  diffAssignees,
  userRoleForAssigneeRole,
} from "@/lib/maintenance/assignment-roles";
import { mayAssignQa } from "@/lib/maintenance/instructions";

/** Statuses that still count as work in front of the assignee. */
export const OPEN_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.ACKNOWLEDGED,
  MaintenanceStatus.IN_PROGRESS,
  MaintenanceStatus.ORDERED,
];

const ASSIGNEE_SELECT = {
  id: true,
  role: true,
  userId: true,
  assignedAt: true,
  removedAt: true,
  notifiedAt: true,
  // The lifecycle. Without these the admin panel can only ever say "assigned"
  // and "emailed", which does not distinguish somebody who is on their way from
  // somebody who has not opened the message — the difference that decides
  // whether the office needs to find a second person today.
  acceptedAt: true,
  declinedAt: true,
  declineReason: true,
  completedAt: true,
  completionNote: true,
  // The money, and any open argument about it.
  payType: true,
  payAmount: true,
  payHours: true,
  payPayer: true,
  payChangeAmount: true,
  payChangeReason: true,
  payChangeStatus: true,
  payChangeAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } },
} as const;

export type MaintenanceAssignmentRow = Awaited<ReturnType<typeof listItemAssignments>>[number];

/** The full roster for one item, active rows first, in canonical role order. */
export async function listItemAssignments(itemId: string) {
  const rows = await db.maintenanceItemAssignment.findMany({
    where: { itemId },
    select: ASSIGNEE_SELECT,
    orderBy: [{ assignedAt: "asc" }],
  });
  // Canonical role order is a presentation rule, not a database one — sorting
  // here keeps every caller (admin panel, API, portal) showing the same order.
  return rows.sort(
    (a, b) => MAINTENANCE_ASSIGNEE_ROLES.indexOf(a.role) - MAINTENANCE_ASSIGNEE_ROLES.indexOf(b.role)
  );
}

/**
 * Replace the roster for ONE role on an item, leaving the other two roles alone.
 * That isolation is the point: saving the cleaner column must never disturb who
 * the QA inspector is.
 *
 * Returns the diff so the caller can email only the people who are NEW to the
 * item — re-saving an unchanged roster sends nothing.
 */
export async function setItemAssignees(input: {
  itemId: string;
  role: MaintenanceAssigneeRole;
  userIds: string[];
  assignedByUserId?: string | null;
}): Promise<{ added: string[]; removed: string[]; kept: string[] }> {
  const { itemId, role } = input;

  const item = await db.propertyMaintenanceItem.findUnique({
    where: { id: itemId },
    select: { id: true },
  });
  if (!item) throw new Error("Maintenance item not found.");

  // Only an active account holding the matching role may wear that hat. A
  // cleaner cannot be filed under QA, and a deactivated account cannot be given
  // work it will never see.
  const requiredRole = userRoleForAssigneeRole(role);
  const wanted = Array.from(new Set(input.userIds));
  const eligible =
    wanted.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: wanted }, role: requiredRole, isActive: true },
          select: { id: true },
        });
  const eligibleIds = new Set(eligible.map((u) => u.id));
  const rejected = wanted.filter((id) => !eligibleIds.has(id));
  if (rejected.length > 0) {
    throw new Error(
      `Only active ${requiredRole} accounts can hold the ${role} role. Rejected: ${rejected.join(", ")}`
    );
  }
  const nextUserIds = wanted.filter((id) => eligibleIds.has(id));

  await assertNoSelfReview({ itemId, role, userIds: nextUserIds });

  const existing = await db.maintenanceItemAssignment.findMany({
    where: { itemId, role, removedAt: null },
    select: { userId: true },
  });
  const diff = diffAssignees(
    existing.map((row) => row.userId),
    nextUserIds
  );

  const now = new Date();
  await db.$transaction(async (tx) => {
    if (diff.removed.length > 0) {
      await tx.maintenanceItemAssignment.updateMany({
        where: { itemId, role, removedAt: null, userId: { in: diff.removed } },
        data: { removedAt: now },
      });
    }
    for (const userId of diff.added) {
      await tx.maintenanceItemAssignment.upsert({
        where: { itemId_userId_role: { itemId, userId, role } },
        create: {
          itemId,
          userId,
          role,
          assignedAt: now,
          assignedById: input.assignedByUserId ?? null,
        },
        // A re-offer after a removal: revive the row and clear `notifiedAt` so
        // the person is told again rather than silently re-added.
        update: {
          removedAt: null,
          assignedAt: now,
          assignedById: input.assignedByUserId ?? null,
          notifiedAt: null,
        },
      });
    }
  });

  return diff;
}

/**
 * NOBODY INSPECTS THEIR OWN WORK. The failsafe, enforced on the write path.
 *
 * `mayAssignQa` has expressed this rule for a while, and nothing called it — so
 * the rule existed in the test suite and nowhere a save could reach. This is
 * where it becomes real.
 *
 * Blocked in BOTH directions, because a one-way check is defeated by the order
 * of the saves: assign someone QA first, then cleaner, and a QA-only guard
 * waves it through. The pair is what is illegal, not the sequence.
 *
 * A cleaner on the JOB this item came from counts too. The person who cleaned
 * the room is the person whose work the QA visit is judging, whether or not
 * they were also filed against the repair.
 *
 * Throws rather than silently dropping the name: an admin who ticked a box and
 * saw it quietly untick would tick it again, and the third time would assume
 * the system was broken rather than that it was refusing.
 */
async function assertNoSelfReview(input: {
  itemId: string;
  role: MaintenanceAssigneeRole;
  userIds: string[];
}): Promise<void> {
  if (input.userIds.length === 0) return;
  if (input.role === MaintenanceAssigneeRole.MAINTENANCE) return;

  const opposite =
    input.role === MaintenanceAssigneeRole.QA
      ? MaintenanceAssigneeRole.CLEANER
      : MaintenanceAssigneeRole.QA;

  const [item, held] = await Promise.all([
    db.propertyMaintenanceItem.findUnique({
      where: { id: input.itemId },
      select: { jobId: true },
    }),
    db.maintenanceItemAssignment.findMany({
      where: { itemId: input.itemId, role: opposite, removedAt: null },
      select: { userId: true },
    }),
  ]);

  const conflicting = new Set(held.map((row) => row.userId));

  // Only the QA direction consults the job: being on the clean disqualifies you
  // from inspecting it, but having inspected a repair does not disqualify you
  // from cleaning the property later.
  if (input.role === MaintenanceAssigneeRole.QA && item?.jobId) {
    const cleaners = await db.jobAssignment.findMany({
      where: { jobId: item.jobId, removedAt: null },
      select: { userId: true },
    });
    for (const row of cleaners) conflicting.add(row.userId);
  }

  const jobCleanerUserIds = Array.from(conflicting);
  const blocked = input.userIds.filter(
    (candidateUserId) => !mayAssignQa({ candidateUserId, jobCleanerUserIds })
  );
  if (blocked.length === 0) return;

  const names = await db.user.findMany({
    where: { id: { in: blocked } },
    select: { name: true, email: true },
  });
  const who = names.map((u) => u.name ?? u.email ?? "that person").join(", ");
  throw new Error(
    input.role === MaintenanceAssigneeRole.QA
      ? `${who} cleaned this work, so they cannot inspect it. Pick someone else for QA.`
      : `${who} is the QA inspector on this item, so they cannot also do the cleaning. Remove them from QA first.`
  );
}

/** Stamp the rows whose "you've been assigned" email actually went out. */
export async function markAssigneesNotified(input: {
  itemId: string;
  role: MaintenanceAssigneeRole;
  userIds: string[];
}): Promise<void> {
  if (input.userIds.length === 0) return;
  await db.maintenanceItemAssignment.updateMany({
    where: { itemId: input.itemId, role: input.role, userId: { in: input.userIds }, removedAt: null },
    data: { notifiedAt: new Date() },
  });
}

/**
 * The portal gate. How many maintenance items is this person currently on?
 * Zero means their portal shows no maintenance section at all.
 *
 * `openOnly` (the default) ignores resolved/dismissed items so the section
 * disappears once the work is finished rather than lingering forever.
 */
export async function countActiveAssignmentsForUser(
  userId: string,
  opts?: { openOnly?: boolean }
): Promise<number> {
  const openOnly = opts?.openOnly ?? true;
  return db.maintenanceItemAssignment.count({
    where: {
      userId,
      removedAt: null,
      ...(openOnly ? { item: { status: { in: OPEN_MAINTENANCE_STATUSES } } } : {}),
    },
  });
}

/** True when this person holds any active hat on this specific item. */
export async function userIsAssignedToItem(userId: string, itemId: string): Promise<boolean> {
  const row = await db.maintenanceItemAssignment.findFirst({
    where: { itemId, userId, removedAt: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The items this person is on, for their own portal section. Scoped by the
 * assignment table only — never by property or job, because being assigned IS
 * the permission.
 */
export async function listMaintenanceItemsForUser(
  userId: string,
  opts?: { scope?: "active" | "history"; take?: number }
) {
  const scope = opts?.scope ?? "active";
  const rows = await db.maintenanceItemAssignment.findMany({
    where: {
      userId,
      removedAt: null,
      item: {
        status:
          scope === "history"
            ? { in: [MaintenanceStatus.RESOLVED, MaintenanceStatus.DISMISSED] }
            : { in: OPEN_MAINTENANCE_STATUSES },
      },
    },
    orderBy: [{ assignedAt: "desc" }],
    take: opts?.take ?? 100,
    select: {
      id: true,
      role: true,
      assignedAt: true,
      acceptedAt: true,
      declinedAt: true,
      completedAt: true,
      payType: true,
      payAmount: true,
      payHours: true,
      payPayer: true,
      payChangeStatus: true,
      payChangeAmount: true,
      item: {
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          area: true,
          priority: true,
          status: true,
          scheduledFor: true,
          resolvedAt: true,
          property: { select: { id: true, name: true, suburb: true, address: true } },
          assignmentInstructions: true,
        },
      },
    },
  });

  // One person can hold two hats on the same item (rare, but legal). Collapse to
  // one card per item carrying every role, so the portal never shows a duplicate.
  type Collapsed = {
    item: (typeof rows)[number]["item"];
    roles: MaintenanceAssigneeRole[];
    assignedAt: Date;
    /** The row the ACTIONS act on. When someone holds two hats on one item,
     *  this is the first — accepting once is accepting the work, and asking
     *  them to accept the same job twice because of an internal role split
     *  would be an implementation detail leaking onto their phone. */
    assignment: Omit<(typeof rows)[number], "item">;
  };
  const byItem = new Map<string, Collapsed>();
  for (const row of rows) {
    const found = byItem.get(row.item.id);
    if (found) {
      if (!found.roles.includes(row.role)) found.roles.push(row.role);
      continue;
    }
    const { item, ...assignment } = row;
    byItem.set(row.item.id, {
      item,
      roles: [row.role],
      assignedAt: row.assignedAt,
      assignment,
    });
  }
  return Array.from(byItem.values()).map((entry) => ({
    ...entry,
    roles: MAINTENANCE_ASSIGNEE_ROLES.filter((role) => entry.roles.includes(role)),
  }));
}

/** Candidate people for one role's picker in the admin panel. */
export async function listAssignableUsers(role: MaintenanceAssigneeRole) {
  return db.user.findMany({
    where: { role: userRoleForAssigneeRole(role), isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }],
    take: 500,
  });
}

/** Every role's candidate list in one round-trip, keyed by maintenance role. */
export async function listAllAssignableUsers(): Promise<
  Record<MaintenanceAssigneeRole, Array<{ id: string; name: string | null; email: string | null }>>
> {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: [Role.MAINTENANCE, Role.CLEANER, Role.QA_INSPECTOR] },
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: "asc" }],
    take: 1500,
  });
  const out = {
    [MaintenanceAssigneeRole.MAINTENANCE]: [] as Array<{ id: string; name: string | null; email: string | null }>,
    [MaintenanceAssigneeRole.CLEANER]: [] as Array<{ id: string; name: string | null; email: string | null }>,
    [MaintenanceAssigneeRole.QA]: [] as Array<{ id: string; name: string | null; email: string | null }>,
  };
  for (const user of users) {
    const bucket =
      user.role === Role.MAINTENANCE
        ? MaintenanceAssigneeRole.MAINTENANCE
        : user.role === Role.CLEANER
          ? MaintenanceAssigneeRole.CLEANER
          : MaintenanceAssigneeRole.QA;
    out[bucket].push({ id: user.id, name: user.name, email: user.email });
  }
  return out;
}
