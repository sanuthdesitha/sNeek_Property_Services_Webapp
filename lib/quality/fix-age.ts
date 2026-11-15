/**
 * The 48-hour fix rule, in one place.
 *
 * A fix is "owed" while the issue's rectification status is one of the open
 * statuses (OPEN_RECTIFICATION_STATUSES). It is overdue once more than 48
 * hours have passed since the issue was raised. The "Fixes still open" stat
 * card ("N over 48 h"), the Issues tab's tint and its "52 h, over 48 h" hint
 * all read this rule, so they can never disagree.
 *
 * Pure (no database, no React): safe for server services, API routes and
 * client components alike.
 */
import { isOpenRectification } from "./types";

export const FIX_OVERDUE_HOURS = 48;
export const FIX_OVERDUE_MS = FIX_OVERDUE_HOURS * 3_600_000;

/** How long a fix has been owed. `hours` is whole hours since the issue was raised. */
export type FixOwedAge = {
  hours: number;
  overdue: boolean;
};

/**
 * The age of an owed fix, or null when no fix is owed (the issue is fixed) or
 * the raised time cannot be read. Unknown is null, never "0 hours".
 */
export function fixOwedAge(rectificationStatus: string, createdAt: Date | string | null | undefined, now: Date): FixOwedAge | null {
  if (!isOpenRectification(rectificationStatus)) return null;
  if (!createdAt) return null;
  const raised = new Date(createdAt);
  if (Number.isNaN(raised.getTime())) return null;
  const elapsed = Math.max(0, now.getTime() - raised.getTime());
  return { hours: Math.floor(elapsed / 3_600_000), overdue: elapsed > FIX_OVERDUE_MS };
}

/** True when a fix is owed and has been owed for more than 48 hours. */
export function isFixOverdue(rectificationStatus: string, createdAt: Date | string | null | undefined, now: Date): boolean {
  return fixOwedAge(rectificationStatus, createdAt, now)?.overdue ?? false;
}
