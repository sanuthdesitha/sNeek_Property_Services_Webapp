/**
 * Canonical "whose inspection is this?" rules.
 *
 * A QaAssignment carries TWO people columns and, before this module, five
 * different call sites each invented their own answer:
 *
 *   - `assignedToId`  — an admin handed the inspection to this inspector.
 *   - `pickedUpById`  — this inspector actually opened/performed it.
 *
 * Only ONE of those is ever set on a self-serve inspection: `/pickup`, the
 * on-site timer and the submit path all stamp `pickedUpById` and leave
 * `assignedToId` null. The pay rail, payroll and the cleaner-invoice rail all
 * keyed on `assignedToId` alone, so every self-picked-up inspection was
 * invisible to the inspector's pay page and unpayable on both settlement
 * rails — permanently. That is what these helpers exist to prevent recurring.
 *
 * Two distinct questions, deliberately kept apart:
 *
 *   VISIBILITY — "may this person see / act on this inspection?" Either column
 *   matching is enough; an inspector who was assigned an inspection and one who
 *   picked it up both have a legitimate claim to open it.
 *
 *   PAYEE — "who gets paid for it?" This must resolve to exactly ONE person or
 *   the same inspection can be billed twice on two different rails. Whoever
 *   actually did the work is paid, so `pickedUpById` wins and `assignedToId` is
 *   the fallback for an assignment that was never opened through a path that
 *   stamps a pickup.
 *
 * Deriving the payee (rather than backfilling `assignedToId` from
 * `pickedUpById`) is what makes historical rows payable without mutating a
 * single row of finance data.
 */

/** Rows carrying the two ownership columns. */
export interface QaAssignmentOwnerFields {
  assignedToId?: string | null;
  pickedUpById?: string | null;
}

/**
 * Prisma `where` fragment: inspections this user may see or act on.
 * Spread it — do NOT let it replace a status filter (the QA queue's "completed"
 * scope used to swap this out instead of extending it, leaking every
 * inspector's completed work to every other inspector).
 */
export function qaAssignmentOwnerWhere(userId: string) {
  return { OR: [{ assignedToId: userId }, { pickedUpById: userId }] };
}

/**
 * Visibility, plus unclaimed work. Used by the queue and pickup paths where an
 * inspector may legitimately take an assignment nobody owns yet.
 */
export function qaAssignmentClaimableWhere(userId: string) {
  return {
    OR: [{ assignedToId: null }, { assignedToId: userId }, { pickedUpById: userId }],
  };
}

/**
 * Prisma `where` fragment: inspections THIS user is the payee of.
 *
 * Mirrors `qaAssignmentPayeeId` exactly — if you change one, change both, or
 * the money a query selects will stop matching the money it attributes.
 */
export function qaAssignmentPayeeWhere(userId: string) {
  return {
    OR: [
      { pickedUpById: userId },
      // Assigned but never picked up: the assignee is the payee by fallback.
      { AND: [{ pickedUpById: null }, { assignedToId: userId }] },
    ],
  };
}

/**
 * Prisma `where` fragment: inspections that have a payee at all.
 *
 * Payroll scans a whole period across every payee and attributes rows in
 * memory, so it needs "is payable by someone" rather than "is payable by X".
 */
export function qaAssignmentHasPayeeWhere() {
  return {
    OR: [{ pickedUpById: { not: null } }, { assignedToId: { not: null } }],
  };
}

/**
 * Who gets paid for this inspection. Whoever performed it, falling back to
 * whoever it was assigned to. Null only when the row has neither — which
 * `qaAssignmentHasPayeeWhere` already excludes at the query level.
 */
export function qaAssignmentPayeeId(row: QaAssignmentOwnerFields): string | null {
  return row.pickedUpById ?? row.assignedToId ?? null;
}

/** Whether this user may see / act on the inspection. */
export function isQaAssignmentOwner(row: QaAssignmentOwnerFields, userId: string): boolean {
  return row.assignedToId === userId || row.pickedUpById === userId;
}
