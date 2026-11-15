/**
 * Coaching outcomes. Suspended and Terminated are recorded only by
 * administrators (owner default 2026-11-16, pending owner confirmation),
 * confirmed with their own PIN (tier C). Recording one does not change the
 * person's login; that stays in Accounts. Plain module.
 */
import type { Role } from "@prisma/client";

export const COACHING_OUTCOMES = ["NONE", "RETRAINED", "SUSPENDED", "TERMINATED"] as const;
export type CoachingOutcome = (typeof COACHING_OUTCOMES)[number];

export const DISMISSAL_OUTCOMES: readonly CoachingOutcome[] = ["SUSPENDED", "TERMINATED"];

export function isDismissalOutcome(outcome: string | null | undefined): boolean {
  return typeof outcome === "string" && (DISMISSAL_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * The session's held roles, after any "test as" swap: an administrator testing
 * as an operations manager is held to the manager's restriction, and an
 * operations manager never qualifies, whatever their packs say.
 */
export function canRecordDismissal(session: { user: { role: Role; heldRoles?: Role[] } }): boolean {
  const held = session.user.heldRoles ?? [session.user.role];
  return held.includes("ADMIN" as Role);
}
