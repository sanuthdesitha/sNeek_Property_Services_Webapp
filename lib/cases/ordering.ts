/**
 * The order cases are worked in.
 *
 * The list was sorted by `updatedAt` alone, so a lost umbrella someone
 * commented on five minutes ago outranked a damage claim opened this morning.
 * Damage is the type with money and liability attached and a client waiting on
 * an answer, so it leads; a note added to a trivial case should not push it
 * above one.
 *
 * Recency still decides within a type — this reorders the groups, it does not
 * bury anything.
 */

export const CASE_TYPE_PRIORITY: Record<string, number> = {
  DAMAGE: 0,
  CLIENT_DISPUTE: 1,
  SLA: 2,
  LOST_FOUND: 3,
  OPS: 4,
};

/** Unknown or future types sort after the known ones, never silently first. */
const UNKNOWN_PRIORITY = 99;

export function caseTypeRank(caseType: string | null | undefined): number {
  if (!caseType) return UNKNOWN_PRIORITY;
  return CASE_TYPE_PRIORITY[caseType.trim().toUpperCase()] ?? UNKNOWN_PRIORITY;
}

export interface SortableCase {
  caseType?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Damage first, then the rest by type, newest within each.
 *
 * Returns a new array — the caller's list is often React state, and sorting it
 * in place would mutate something React believes it owns.
 */
export function sortCasesByType<T extends SortableCase>(cases: readonly T[]): T[] {
  return [...cases].sort((a, b) => {
    const rank = caseTypeRank(a.caseType) - caseTypeRank(b.caseType);
    if (rank !== 0) return rank;
    const recency = timeOf(b.updatedAt) - timeOf(a.updatedAt);
    if (recency !== 0) return recency;
    return timeOf(b.createdAt) - timeOf(a.createdAt);
  });
}
