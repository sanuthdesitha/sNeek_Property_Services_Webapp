/**
 * Lost and found status transitions. Pure; shared by the item PATCH, the bulk
 * endpoint and the panel (which only offers what this table allows).
 *
 * Everything the old board let the office do from an OPEN item is still a
 * direct move: any other open status (including back to Reported), any final
 * decision, or Archived. From a CLOSED item:
 *  - Unclaimed can still become Returned, Donated or Disposed (the natural
 *    next step once the holding period is over, or the guest turns up);
 *  - any final decision can be archived, keeping the decision on the item;
 *  - going back to an open status is an explicit Reopen with a reason. The
 *    previous decision is kept in the Reopened timeline entry, never silently
 *    erased (the old board cleared it without a trace);
 *  - recording a different final decision means reopening first.
 */
import { isOpenStatus, isResolvedStatus, LOST_FOUND_STATUSES, type LostFoundStatus } from "./status";

export type TransitionKind = "same" | "direct" | "reopen";

export type TransitionCheck = { ok: true; kind: TransitionKind } | { ok: false; reason: string };

const AFTER_UNCLAIMED: LostFoundStatus[] = ["RETURNED", "DONATED", "DISPOSED"];

export function checkLostFoundTransition(from: LostFoundStatus, to: LostFoundStatus, reopenReason?: string | null): TransitionCheck {
  if (from === to) return { ok: true, kind: "same" };
  if (isOpenStatus(from)) return { ok: true, kind: "direct" };
  if (from === "UNCLAIMED" && AFTER_UNCLAIMED.includes(to)) return { ok: true, kind: "direct" };
  if (isResolvedStatus(from) && to === "ARCHIVED") return { ok: true, kind: "direct" };
  if (isOpenStatus(to)) {
    if (!reopenReason?.trim()) return { ok: false, reason: "Give a reason to reopen a closed item." };
    return { ok: true, kind: "reopen" };
  }
  return { ok: false, reason: "Reopen the item first to record a different final decision." };
}

export type TransitionOption = { status: LostFoundStatus; kind: TransitionKind };

/** Every status reachable from `from`, and how (for the panel's controls). */
export function lostFoundTransitionOptions(from: LostFoundStatus): TransitionOption[] {
  return LOST_FOUND_STATUSES.flatMap((status) => {
    if (status === from) return [];
    const check = checkLostFoundTransition(from, status, "reason");
    return check.ok ? [{ status, kind: check.kind }] : [];
  });
}
