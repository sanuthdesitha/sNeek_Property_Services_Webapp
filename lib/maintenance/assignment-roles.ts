/**
 * CP-6 — pure rules for multi-role maintenance assignment.
 *
 * A maintenance item can be worked by several people at once wearing different
 * hats: a maintenance worker, a cleaner and a QA inspector. The admin UI shows
 * the three SEPARATELY, and each person's own portal reveals its maintenance
 * section only when they are actually on an item.
 *
 * Everything here is pure — no `db`, no `fetch`, no dates formatted. That keeps
 * "who can see this" and "which roles are assigned" unit-testable without a
 * database, which is the only test harness this repo has.
 *
 * Convention borrowed from JobAssignment: rows are never deleted, they are
 * stamped `removedAt`, so `removedAt === null` is the definition of "assigned".
 */
import { MaintenanceAssigneeRole, Role } from "@prisma/client";

/**
 * Canonical display order. Maintenance leads because they do the repair; the
 * cleaner follows the repair; QA signs off last.
 */
export const MAINTENANCE_ASSIGNEE_ROLES: MaintenanceAssigneeRole[] = [
  MaintenanceAssigneeRole.MAINTENANCE,
  MaintenanceAssigneeRole.CLEANER,
  MaintenanceAssigneeRole.QA,
];

export const MAINTENANCE_ASSIGNEE_ROLE_LABELS: Record<MaintenanceAssigneeRole, string> = {
  [MaintenanceAssigneeRole.MAINTENANCE]: "Maintenance worker",
  [MaintenanceAssigneeRole.CLEANER]: "Cleaner",
  [MaintenanceAssigneeRole.QA]: "QA inspector",
};

/** The portal path each assignee role reads its maintenance section from. */
export const MAINTENANCE_SECTION_HREF: Record<MaintenanceAssigneeRole, string> = {
  [MaintenanceAssigneeRole.MAINTENANCE]: "/v2/maintenance/tickets",
  [MaintenanceAssigneeRole.CLEANER]: "/v2/cleaner/maintenance",
  [MaintenanceAssigneeRole.QA]: "/v2/qa/maintenance",
};

/**
 * The maintenance hat a given account role wears. Returns null for roles that
 * cannot be assigned maintenance work at all (ADMIN, OPS_MANAGER, CLIENT,
 * LAUNDRY) — admins manage the item, they are not on it.
 */
export function assigneeRoleForUserRole(role: Role): MaintenanceAssigneeRole | null {
  switch (role) {
    case Role.MAINTENANCE:
      return MaintenanceAssigneeRole.MAINTENANCE;
    case Role.CLEANER:
      return MaintenanceAssigneeRole.CLEANER;
    case Role.QA_INSPECTOR:
      return MaintenanceAssigneeRole.QA;
    default:
      return null;
  }
}

/** The account role that may hold a given maintenance hat. Inverse of the above. */
export function userRoleForAssigneeRole(role: MaintenanceAssigneeRole): Role {
  switch (role) {
    case MaintenanceAssigneeRole.MAINTENANCE:
      return Role.MAINTENANCE;
    case MaintenanceAssigneeRole.CLEANER:
      return Role.CLEANER;
    case MaintenanceAssigneeRole.QA:
      return Role.QA_INSPECTOR;
  }
}

/** The minimum shape the rules below need. Real rows carry much more. */
export interface AssignmentRow {
  userId: string;
  role: MaintenanceAssigneeRole;
  removedAt: Date | null;
}

/** A row still in force. An un-assigned row keeps its history but stops counting. */
export function isActiveAssignment(row: Pick<AssignmentRow, "removedAt">): boolean {
  return row.removedAt === null || row.removedAt === undefined;
}

export function activeAssignments<T extends Pick<AssignmentRow, "removedAt">>(rows: readonly T[]): T[] {
  return rows.filter(isActiveAssignment);
}

/**
 * Split the active roster into the three role buckets, in canonical order.
 * This is what makes the admin UI show the roles SEPARATELY rather than as one
 * mixed list — every bucket exists even when empty, so the UI renders a
 * consistent three-column layout instead of collapsing missing roles.
 */
export function groupAssignmentsByRole<T extends Pick<AssignmentRow, "role" | "removedAt">>(
  rows: readonly T[]
): Record<MaintenanceAssigneeRole, T[]> {
  const grouped = {
    [MaintenanceAssigneeRole.MAINTENANCE]: [] as T[],
    [MaintenanceAssigneeRole.CLEANER]: [] as T[],
    [MaintenanceAssigneeRole.QA]: [] as T[],
  } satisfies Record<MaintenanceAssigneeRole, T[]>;

  for (const row of activeAssignments(rows)) {
    grouped[row.role].push(row);
  }
  return grouped;
}

/** Every hat this person currently wears on the item, in canonical order. */
export function assignedRolesForUser(
  rows: readonly AssignmentRow[],
  userId: string
): MaintenanceAssigneeRole[] {
  const held = new Set(
    activeAssignments(rows)
      .filter((row) => row.userId === userId)
      .map((row) => row.role)
  );
  return MAINTENANCE_ASSIGNEE_ROLES.filter((role) => held.has(role));
}

/**
 * The portal gate: does this person's maintenance section exist at all?
 *
 * True only when they hold at least one ACTIVE assignment. Being removed from
 * every item takes the section away again — the section is a consequence of
 * being assigned, not a permanent property of the account.
 */
export function canSeeMaintenanceSection(rows: readonly AssignmentRow[], userId: string): boolean {
  return assignedRolesForUser(rows, userId).length > 0;
}

/**
 * What changed when an admin submits a new roster for ONE role.
 *
 * `added` is the only list that earns an email: re-saving an unchanged roster,
 * or dropping someone, must not re-notify the people who were already on it.
 * All three lists are de-duplicated and returned in the caller's input order.
 */
export function diffAssignees(
  currentUserIds: readonly string[],
  nextUserIds: readonly string[]
): { added: string[]; removed: string[]; kept: string[] } {
  const current = new Set(currentUserIds);
  const next = new Set(nextUserIds);
  const seen = new Set<string>();

  const added: string[] = [];
  const kept: string[] = [];
  for (const id of nextUserIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (current.has(id)) kept.push(id);
    else added.push(id);
  }

  const removedSeen = new Set<string>();
  const removed: string[] = [];
  for (const id of currentUserIds) {
    if (removedSeen.has(id) || next.has(id)) continue;
    removedSeen.add(id);
    removed.push(id);
  }

  return { added, removed, kept };
}
