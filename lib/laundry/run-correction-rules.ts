/**
 * Office corrections to a laundry run: "Change state" and "Void" (owner
 * request 2026-11-14, boards LaundryRunActions and LaundryRunDetail).
 *
 * PURE and PLAIN (no "use client", no Prisma client import): the routes, the
 * server service, the run page and the tests share one answer.
 *
 * Change state records what really happened. A later state needs the real
 * date and time it happened (never "now" by default, never in the future,
 * never before the cleaner's handoff), who did it and a reason. Moving back
 * is allowed with a warning, and refused past Dropped off once the run has
 * been on an emailed laundry report. "Picked up" and "At the laundry" are one
 * stored state (PICKED_UP).
 *
 * Void says a run should never have counted. It is offered on Skipped and
 * Flagged runs and on failed runs still waiting for pickup, and refused once
 * the run has been on an emailed laundry report.
 */

export type LaundryStatusValue =
  | "PENDING"
  | "CONFIRMED"
  | "PICKED_UP"
  | "READY_TO_RETURN"
  | "DROPPED"
  | "FLAGGED"
  | "SKIPPED_PICKUP";

/** The choices in the Change state dialog. */
export const CHANGE_STATE_TARGETS = ["NOT_PICKED_UP", "PICKED_UP", "READY_TO_RETURN", "DROPPED", "SKIPPED", "FLAGGED"] as const;
export type ChangeStateTarget = (typeof CHANGE_STATE_TARGETS)[number];

export const CHANGE_STATE_LABELS: Readonly<Record<ChangeStateTarget, { label: string; hint: string }>> = {
  NOT_PICKED_UP: { label: "Not picked up yet", hint: "Waiting for pickup, or Confirmed when the cleaner's handoff said ready" },
  PICKED_UP: { label: "Picked up, at the laundry", hint: "Asks when and by whom" },
  READY_TO_RETURN: { label: "Ready to return", hint: "Asks the pickup time too if it is missing" },
  DROPPED: { label: "Dropped off", hint: "Asks the pickup and drop-off times" },
  SKIPPED: { label: "Skipped", hint: "No pickup needed; asks the skip reason" },
  FLAGGED: { label: "Flagged", hint: "Needs a decision; asks a flag note" },
};

/** Where a run is along the round trip: 0 waiting, 1 at the laundry, 2 ready, 3 delivered. */
export type TripRank = 0 | 1 | 2 | 3;

export type CorrectionTaskFacts = {
  status: LaundryStatusValue | string;
  pickedUpAt: Date | string | null;
  droppedAt: Date | string | null;
  voidedAt?: Date | string | null;
  /** When the cleaner's latest "ready" handoff was recorded, if any. */
  handoffAt: Date | string | null;
  /** True when a laundry report that contains this run has been emailed. */
  onEmailedReport: boolean;
};

export type ChangeStateRequest = {
  target: ChangeStateTarget;
  /** When the target event happened (pickup, ready mark or drop-off). */
  happenedAt?: string | null;
  /** The pickup time, when the target is later than Picked up and no pickup is recorded. */
  pickedUpAt?: string | null;
  reason: string;
  skipReasonCode?: string | null;
  flagNote?: string | null;
  acknowledgeBackwards?: boolean;
};

export type ChangeStatePlan = {
  ok: true;
  nextStatus: LaundryStatusValue;
  backwards: boolean;
  /** The timestamps the run will carry after the change (null clears). */
  pickedUpAt: Date | null;
  droppedAt: Date | null;
  /** Plain lines for "What will change". */
  changes: string[];
};

export type CorrectionRefusal = { ok: false; status: 400 | 409; code: string; message: string };

const TERMINAL_TARGETS = new Set<ChangeStateTarget>(["SKIPPED", "FLAGGED"]);

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function refuse(status: 400 | 409, code: string, message: string): CorrectionRefusal {
  return { ok: false, status, code, message };
}

/** Where the run is now along the round trip, from its status and recorded times. */
export function currentTripRank(task: Pick<CorrectionTaskFacts, "status" | "pickedUpAt" | "droppedAt">): TripRank {
  if (task.status === "DROPPED") return 3;
  if (task.status === "READY_TO_RETURN") return 2;
  if (task.status === "PICKED_UP") return 1;
  if (task.status === "PENDING" || task.status === "CONFIRMED") return 0;
  // Skipped and Flagged keep whatever was recorded before.
  if (toDate(task.droppedAt)) return 3;
  if (toDate(task.pickedUpAt)) return 1;
  return 0;
}

export function targetRank(target: ChangeStateTarget): TripRank | null {
  switch (target) {
    case "NOT_PICKED_UP": return 0;
    case "PICKED_UP": return 1;
    case "READY_TO_RETURN": return 2;
    case "DROPPED": return 3;
    default: return null;
  }
}

/** The choice the dialog marks "Now" for a run. */
export function currentTarget(status: string): ChangeStateTarget {
  switch (status) {
    case "PICKED_UP": return "PICKED_UP";
    case "READY_TO_RETURN": return "READY_TO_RETURN";
    case "DROPPED": return "DROPPED";
    case "SKIPPED_PICKUP": return "SKIPPED";
    case "FLAGGED": return "FLAGGED";
    default: return "NOT_PICKED_UP";
  }
}

/** True when choosing `target` moves the run back along the round trip. */
export function isBackwardsChange(task: Pick<CorrectionTaskFacts, "status" | "pickedUpAt" | "droppedAt">, target: ChangeStateTarget): boolean {
  const now = currentTripRank(task);
  if (target === "FLAGGED") return false;
  if (target === "SKIPPED") return now >= 1;
  const next = targetRank(target)!;
  return next < now;
}

/**
 * Validate a Change state request against the run and work out exactly what
 * it will store. `now` is passed in so the rule is testable.
 */
export function planChangeState(task: CorrectionTaskFacts, request: ChangeStateRequest, now: Date): ChangeStatePlan | CorrectionRefusal {
  if (toDate(task.voidedAt ?? null)) return refuse(409, "VOIDED", "This run is voided. Undo the void before changing its state.");
  if (!request.reason || request.reason.trim().length < 3) return refuse(400, "REASON_REQUIRED", "Give the reason for the correction.");
  if (currentTarget(String(task.status)) === request.target) return refuse(409, "SAME_STATE", "The run is already in that state.");

  const backwards = isBackwardsChange(task, request.target);
  if (backwards && !request.acknowledgeBackwards) {
    return refuse(409, "BACKWARDS_NOT_ACKNOWLEDGED", "Moving the run back needs you to confirm the warning.");
  }
  if (backwards && task.onEmailedReport && currentTripRank(task) === 3) {
    return refuse(409, "ON_EMAILED_REPORT", "This run is on a laundry report that has been emailed, so it cannot move back past Dropped off.");
  }

  const handoffAt = toDate(task.handoffAt);
  const existingPickup = toDate(task.pickedUpAt);
  const existingDrop = toDate(task.droppedAt);
  const checkTime = (value: string | null | undefined, label: string): Date | CorrectionRefusal => {
    const date = toDate(value ?? null);
    if (!date) return refuse(400, "TIME_REQUIRED", `Enter the date and time ${label} happened.`);
    if (date.getTime() > now.getTime()) return refuse(400, "TIME_IN_FUTURE", `The ${label} time cannot be in the future.`);
    if (handoffAt && date.getTime() < handoffAt.getTime()) return refuse(400, "TIME_BEFORE_HANDOFF", `The ${label} time cannot be before the cleaner's handoff.`);
    return date;
  };

  const changes: string[] = [];
  let pickedUpAt: Date | null = existingPickup;
  let droppedAt: Date | null = existingDrop;
  let nextStatus: LaundryStatusValue;

  switch (request.target) {
    case "NOT_PICKED_UP": {
      nextStatus = handoffAt ? "CONFIRMED" : "PENDING";
      pickedUpAt = null;
      droppedAt = null;
      break;
    }
    case "PICKED_UP": {
      const at = checkTime(request.happenedAt, "pickup");
      if (!(at instanceof Date)) return at;
      nextStatus = "PICKED_UP";
      pickedUpAt = at;
      droppedAt = null;
      break;
    }
    case "READY_TO_RETURN":
    case "DROPPED": {
      if (!existingPickup) {
        const pickup = checkTime(request.pickedUpAt, "pickup");
        if (!(pickup instanceof Date)) return pickup;
        pickedUpAt = pickup;
      }
      const label = request.target === "DROPPED" ? "drop-off" : "ready to return";
      const at = checkTime(request.happenedAt, label);
      if (!(at instanceof Date)) return at;
      if (pickedUpAt && at.getTime() < pickedUpAt.getTime()) return refuse(400, "TIME_BEFORE_PICKUP", `The ${label} time cannot be before the pickup.`);
      nextStatus = request.target === "DROPPED" ? "DROPPED" : "READY_TO_RETURN";
      droppedAt = request.target === "DROPPED" ? at : null;
      break;
    }
    case "SKIPPED": {
      if (!request.skipReasonCode?.trim()) return refuse(400, "SKIP_REASON_REQUIRED", "Choose the skip reason.");
      nextStatus = "SKIPPED_PICKUP";
      break;
    }
    case "FLAGGED": {
      if (!request.flagNote?.trim()) return refuse(400, "FLAG_NOTE_REQUIRED", "Write what needs deciding.");
      nextStatus = "FLAGGED";
      break;
    }
  }

  changes.push(`State: ${stateName(String(task.status))} → ${stateName(nextStatus)}`);
  if (pickedUpAt && pickedUpAt.getTime() !== existingPickup?.getTime()) changes.push("Pickup recorded by office correction");
  if (!pickedUpAt && existingPickup) changes.push("Pickup time leaves the current state (kept in History)");
  if (droppedAt && droppedAt.getTime() !== existingDrop?.getTime()) changes.push("Drop-off recorded by office correction");
  if (!droppedAt && existingDrop) changes.push("Drop-off time leaves the current state (kept in History)");
  return { ok: true, nextStatus, backwards, pickedUpAt, droppedAt, changes };
}

export function stateName(status: string): string {
  switch (status) {
    case "PENDING": return "Waiting for pickup";
    case "CONFIRMED": return "Confirmed";
    case "PICKED_UP": return "Picked up, at the laundry";
    case "READY_TO_RETURN": return "Ready to return";
    case "DROPPED": return "Dropped off";
    case "FLAGGED": return "Flagged";
    case "SKIPPED_PICKUP": return "Skipped";
    default: return status;
  }
}

/** Optional figures: blank means "not entered" (kept as it is), never zero. */
export type OptionalFigures = { bagCount?: number | null; weightKg?: number | null; price?: number | null };

export function figureProblem(figures: OptionalFigures): string | null {
  if (figures.bagCount != null && (!Number.isInteger(figures.bagCount) || figures.bagCount < 1 || figures.bagCount > 50)) return "Bags must be a whole number from 1 to 50.";
  if (figures.weightKg != null && (!Number.isFinite(figures.weightKg) || figures.weightKg <= 0 || figures.weightKg > 500)) return "Weight must be above 0 and at most 500 kg.";
  if (figures.price != null && (!Number.isFinite(figures.price) || figures.price <= 0 || figures.price > 100000)) return "Price must be above $0.";
  return null;
}

// ─────────────────────────────────────────────
// Void
// ─────────────────────────────────────────────

export type VoidFacts = {
  status: string;
  voidedAt: Date | string | null;
  /** A failed pickup is recorded on the run (reported by the laundry team). */
  hasFailedPickup: boolean;
  onEmailedReport: boolean;
  emailedReportLabel?: string | null;
};

/** Where Void is offered: Skipped, Flagged, and failed runs still waiting for pickup. */
export function isVoidableStatus(facts: Pick<VoidFacts, "status" | "hasFailedPickup">): boolean {
  if (facts.status === "SKIPPED_PICKUP" || facts.status === "FLAGGED") return true;
  return (facts.status === "PENDING" || facts.status === "CONFIRMED") && facts.hasFailedPickup;
}

export function voidRefusal(facts: VoidFacts): CorrectionRefusal | null {
  if (toDate(facts.voidedAt)) return refuse(409, "ALREADY_VOIDED", "This run is already voided.");
  if (!isVoidableStatus(facts)) return refuse(409, "NOT_VOIDABLE", "Only skipped or flagged runs, or runs with a failed pickup still waiting, can be voided. Use Change state instead.");
  if (facts.onEmailedReport) {
    const label = facts.emailedReportLabel ? ` (${facts.emailedReportLabel})` : "";
    return refuse(409, "ON_EMAILED_REPORT", `This run is on a laundry report that has been emailed${label}. An issued record is never rewritten, so it cannot be voided.`);
  }
  return null;
}

export function undoVoidRefusal(facts: { voidedAt: Date | string | null; voidPreviousStatus: string | null }): CorrectionRefusal | null {
  if (!toDate(facts.voidedAt)) return refuse(409, "NOT_VOIDED", "This run is not voided.");
  if (!facts.voidPreviousStatus) return refuse(409, "NO_PREVIOUS_STATE", "The state before the void was not recorded, so it cannot be restored automatically.");
  return null;
}

export function isVoided(task: { voidedAt?: Date | string | null }): boolean {
  return Boolean(toDate(task.voidedAt ?? null));
}

// ─────────────────────────────────────────────
// Emailed laundry reports (the only "issued" trace that exists)
// ─────────────────────────────────────────────

/** One LAUNDRY_REPORT_EMAIL audit row's recorded scope. */
export type EmailedReportScope = {
  createdAt: Date | string;
  /** Run ids the report listed (recorded from 2026-11-14). */
  taskIds?: string[] | null;
  /** The single run of a one-run report. */
  taskId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  propertyId?: string | null;
};

export type EmailedReportRun = {
  id: string;
  propertyId: string;
  pickupDate: Date | string;
  dropoffDate: Date | string;
  droppedAt: Date | string | null;
};

/**
 * Whether an emailed report contains (or may contain) this run. Reports
 * emailed from 2026-11-14 list their run ids. Earlier batch reports did not,
 * so a run is treated as on such a report when the report's date range covers
 * one of the run's dates and the report was for all properties or the run's
 * property: the cautious answer, because a wrong "no" would rewrite an issued
 * record.
 */
export function emailedReportContaining(run: EmailedReportRun, reports: readonly EmailedReportScope[]): EmailedReportScope | null {
  for (const report of reports) {
    if (report.taskId === run.id) return report;
    if (Array.isArray(report.taskIds)) {
      if (report.taskIds.includes(run.id)) return report;
      continue;
    }
    if (report.taskId) continue;
    if (report.propertyId && report.propertyId !== run.propertyId) continue;
    const start = toDate(report.startDate ?? null);
    const end = toDate(report.endDate ?? null);
    if (!start || !end) return report;
    const dates = [run.pickupDate, run.dropoffDate, run.droppedAt].map((value) => toDate(value)).filter((value): value is Date => value !== null);
    if (dates.some((date) => date.getTime() >= start.getTime() && date.getTime() <= end.getTime())) return report;
  }
  return null;
}

export function emailedReportLabel(report: EmailedReportScope): string {
  const sent = toDate(report.createdAt);
  const day = sent ? sent.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" }) : "an earlier date";
  return Array.isArray(report.taskIds) || report.taskId ? `emailed ${day}` : `emailed ${day}, before reports listed their runs`;
}
