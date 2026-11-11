/**
 * Which actions a Cleaners-tab row offers, and which one is the row's single
 * visible button (the hub's one-primary-action convention; the rest sit in the
 * row's "more" menu, so every action that applies is reachable on the row).
 *
 * Order of precedence for the visible button:
 * 1. Start coaching: a recurring-issue pattern with no open coaching (the
 *    existing pattern rule), as before.
 * 2. Review bonus: a bonus awaits a decision (automatic or manual).
 * 3. Propose bonus: none of the above, for an active cleaner.
 * When a bonus is pending, "Propose bonus" stays in the menu; its dialog then
 * warns and links to the pending one.
 *
 * Each action is offered only when the viewer's endpoints would accept it
 * (permissions decided on the server and passed in the hub context).
 */
import type { CleanerRow } from "./hub-types";

export type CleanerRowActionKey = "start-coaching" | "review-bonus" | "propose-bonus";

export type CleanerRowActions = {
  primary: CleanerRowActionKey | null;
  more: CleanerRowActionKey[];
};

export type CleanerRowPermissions = {
  canCoach: boolean;
  canDecideBonus: boolean;
  canProposeBonus: boolean;
};

export const CLEANER_ROW_ACTION_LABEL: Record<CleanerRowActionKey, string> = {
  "start-coaching": "Start coaching",
  "review-bonus": "Review bonus",
  "propose-bonus": "Propose bonus",
};

export function cleanerRowActions(
  row: Pick<CleanerRow, "action" | "pendingBonuses" | "active">,
  permissions: CleanerRowPermissions,
): CleanerRowActions {
  const available: CleanerRowActionKey[] = [];
  if (permissions.canCoach && row.action === "start-coaching") available.push("start-coaching");
  if (permissions.canDecideBonus && row.pendingBonuses.length > 0) available.push("review-bonus");
  if (permissions.canProposeBonus && row.active) available.push("propose-bonus");
  const [primary = null, ...more] = available;
  return { primary, more };
}
