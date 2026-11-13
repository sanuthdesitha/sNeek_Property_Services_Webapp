/**
 * Laundry run full page (`/v2/admin/laundry/runs/[id]`, board LaundryRunDetail):
 * the one primary action chosen by the run's state, the stage bar and the
 * off-track state. PURE and PLAIN so the page, the phone action bar and the
 * tests share one answer.
 */
import type { LaundryTeamRequestKind } from "./nudge-rules";

export type RunPrimaryActionKey =
  | "UNDO_VOID"
  | "DECIDE_SKIP_REQUEST"
  | "ASK_TEAM_CONFIRM_PICKUP"
  | "CHASE_SUPPLIER"
  | "ASK_TEAM_RETURN"
  | "ASK_TEAM_DROP_TIME"
  | "ASK_TEAM_PHOTO"
  | "CHANGE_STATE"
  | "DOWNLOAD_REPORT";

export type RunPrimaryAction = { key: RunPrimaryActionKey; label: string };

export type RunPrimaryFacts = {
  status: string;
  voided: boolean;
  /** A failed-pickup skip or delete request is waiting for an office decision. */
  pendingSkipRequest: boolean;
  /** Exception codes from `detectExceptions`. */
  exceptionCodes: readonly string[];
  /** Team request kinds that apply now (`laundryTeamRequestKinds`), empty when the partner has no team. */
  teamRequestKinds: readonly LaundryTeamRequestKind[];
  /** Chase supplier applies now (`supplierChaseApplies`). */
  canChase: boolean;
  /** The viewer may undo a void (administrators). */
  canUndoVoid: boolean;
  /** The viewer may change the state (ADMIN, OPS_MANAGER with the laundry pack at manage). */
  canChangeState: boolean;
};

const DOWNLOAD: RunPrimaryAction = { key: "DOWNLOAD_REPORT", label: "Download run report" };
const CHANGE: RunPrimaryAction = { key: "CHANGE_STATE", label: "Change state…" };

/**
 * The next thing a person must do at this state:
 * voided → Undo void; a waiting skip request → Decide skip request;
 * waiting for pickup → Ask laundry team: confirm pickup; at the laundry over
 * turnaround → Chase supplier; at the laundry → when will it be back / drop
 * time; dropped off without a photo → Ask for drop photo; otherwise Change
 * state (or the run report when the viewer may not change it).
 */
export function primaryRunAction(facts: RunPrimaryFacts): RunPrimaryAction {
  const fallback = facts.canChangeState ? CHANGE : DOWNLOAD;
  if (facts.voided) return facts.canUndoVoid ? { key: "UNDO_VOID", label: "Undo void" } : DOWNLOAD;
  if (facts.pendingSkipRequest) return { key: "DECIDE_SKIP_REQUEST", label: "Decide skip request" };
  const kinds = new Set(facts.teamRequestKinds);
  switch (facts.status) {
    case "PENDING":
    case "CONFIRMED":
      if (kinds.has("TEAM_CONFIRM_PICKUP")) return { key: "ASK_TEAM_CONFIRM_PICKUP", label: "Ask laundry team: confirm pickup" };
      return fallback;
    case "PICKED_UP":
    case "READY_TO_RETURN":
      if (facts.exceptionCodes.includes("OVER_TURNAROUND") && facts.canChase) return { key: "CHASE_SUPPLIER", label: "Chase supplier" };
      if (kinds.has("TEAM_RETURN_ETA")) return { key: "ASK_TEAM_RETURN", label: "Ask laundry team: when will it be back?" };
      if (kinds.has("TEAM_CONFIRM_DROP")) return { key: "ASK_TEAM_DROP_TIME", label: "Ask laundry team: drop time" };
      return fallback;
    case "DROPPED":
      if (facts.exceptionCodes.includes("NO_DROP_PHOTO") && kinds.has("TEAM_PHOTO")) return { key: "ASK_TEAM_PHOTO", label: "Ask laundry team for photo" };
      return DOWNLOAD;
    default:
      return fallback;
  }
}

export const RUN_STAGES = ["Waiting for pickup", "Confirmed", "Picked up", "At the laundry", "Ready to return", "Dropped off"] as const;
export type RunStageState = "done" | "now" | "todo" | "stuck";

/** The stage bar: six steps along the round trip; Picked up and At the laundry are one stored state. */
export function runStageStates(input: { status: string; pickedUpAt: Date | string | null; droppedAt: Date | string | null; failedPickups: number }): RunStageState[] {
  const { status } = input;
  const rank =
    status === "DROPPED" ? 5
      : status === "READY_TO_RETURN" ? 4
        : status === "PICKED_UP" ? 3
          : status === "CONFIRMED" ? 1
            : status === "PENDING" ? 0
              : input.droppedAt ? 5 : input.pickedUpAt ? 3 : status === "FLAGGED" || status === "SKIPPED_PICKUP" ? 1 : 0;
  const offTrack = status === "FLAGGED" || status === "SKIPPED_PICKUP";
  return RUN_STAGES.map((_, index) => {
    if (offTrack) {
      if (index < rank || (index === rank && rank > 0)) return "done";
      if (index === rank + 1 && input.failedPickups > 0 && rank < 2) return "stuck";
      return "todo";
    }
    // At the laundry (3) means picked up (2) is done too.
    if (index < rank || (rank === 3 && index === 2)) return "done";
    if (index === rank) return rank === 5 ? "done" : "now";
    return "todo";
  });
}

export type RunOffTrack = "FLAGGED" | "SKIPPED" | "VOIDED" | null;

export function runOffTrack(task: { status: string; voided: boolean }): RunOffTrack {
  if (task.voided) return "VOIDED";
  if (task.status === "FLAGGED") return "FLAGGED";
  if (task.status === "SKIPPED_PICKUP") return "SKIPPED";
  return null;
}
