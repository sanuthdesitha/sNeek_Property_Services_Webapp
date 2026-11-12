/**
 * Which on-demand laundry requests a run offers, read from the Pipeline's own
 * exception rules (./pipeline.ts) and the run's handoff state. PURE.
 *
 * Owner decision (2026-11-12): "Laundry pickup/drop off is handled by laundry
 * partners/suppliers only". So:
 *
 * - The CLEANER is asked only about what cleaners do at the property: bagging
 *   and handoff readiness ("Ask cleaner": the latest handoff says NOT_READY,
 *   or the bags are not confirmed although the pickup day has come and the
 *   clean is no longer in progress).
 * - The LAUNDRY PARTNER'S TEAM (the LAUNDRY portal users of the run's
 *   supplier, scope LAUNDRY_TASK_SUPPLIER_TEAM) is asked about pickup,
 *   drop-off, photos and the return date:
 *     TEAM_CONFIRM_PICKUP  pickup due/overdue while the bags are not reported
 *                          not-ready;
 *     TEAM_MOVE_PICKUP     pickup day reached and the bags are not out yet
 *                          (ask whether the pickup can move later);
 *     TEAM_CONFIRM_DROP    picked up and the drop day has come;
 *     TEAM_RETURN_ETA      picked up and over turnaround or the drop is overdue;
 *     TEAM_PHOTO           delivered without the required drop-off photo
 *                          (to the team member who delivered, when known).
 *   A run without a supplier offers none (nobody to ask; record the supplier
 *   first). A supplier with no linked portal users disables the button with
 *   the reason and offers "Chase supplier" (stored contact) instead.
 *
 * Every request goes through the notification intent pipeline with the
 * cool-down below per run and kind, enforced on the server
 * (lib/notifications/office-actions.ts).
 */
import { dayKeyOf, type PipelineException } from "./pipeline";
import { isAtLaundryStatus } from "./status-groups";

/** Cleaner nudges. REQUEST_PHOTO is still accepted from older screens but no longer offered. */
export type LaundryNudgeKind = "ASK_CLEANER" | "REQUEST_PHOTO";

export type LaundryTeamRequestKind = "TEAM_CONFIRM_PICKUP" | "TEAM_MOVE_PICKUP" | "TEAM_CONFIRM_DROP" | "TEAM_RETURN_ETA" | "TEAM_PHOTO";

export const LAUNDRY_TEAM_REQUEST_KINDS: readonly LaundryTeamRequestKind[] = ["TEAM_CONFIRM_PICKUP", "TEAM_MOVE_PICKUP", "TEAM_CONFIRM_DROP", "TEAM_RETURN_ETA", "TEAM_PHOTO"];

export const NUDGE_COOL_DOWN_MINUTES = 30;

type RequestLabel = { button: string; title: string; text: string };

export const NUDGE_LABELS: Record<LaundryNudgeKind, RequestLabel> = {
  ASK_CLEANER: {
    button: "Ask cleaner: bags out?",
    title: "Ask the cleaner about the bags",
    text: "The office needs to know whether the laundry for this job is bagged and ready for pickup, and how many bags there are.",
  },
  REQUEST_PHOTO: {
    button: "Request photo",
    title: "Request a laundry photo",
    text: "The office asks for a photo of the laundry for this job.",
  },
};

export const TEAM_REQUEST_LABELS: Record<LaundryTeamRequestKind, RequestLabel> = {
  TEAM_CONFIRM_PICKUP: {
    button: "Ask laundry team: confirm pickup",
    title: "Ask laundry team: confirm pickup",
    text: "The office asks you to confirm the laundry pickup for this property, or tell us when it will happen.",
  },
  TEAM_MOVE_PICKUP: {
    button: "Ask laundry team: move pickup",
    title: "Ask laundry team: move pickup",
    text: "The clean is running late, so the bags are not out yet. The office asks whether you can collect later today.",
  },
  TEAM_CONFIRM_DROP: {
    button: "Ask laundry team: drop time",
    title: "Ask laundry team: drop time",
    text: "The office asks you to confirm the laundry drop-off for this property, or tell us when it will happen.",
  },
  TEAM_RETURN_ETA: {
    button: "Ask laundry team: when will it be back?",
    title: "Ask laundry team: when will it be back?",
    text: "The office asks when the laundry for this property will be ready and delivered.",
  },
  TEAM_PHOTO: {
    button: "Ask laundry team for photo",
    title: "Ask laundry team for photo",
    text: "The office asks for the drop-off photo for this property's laundry.",
  },
};

export type NudgeRunFacts = {
  status: string;
  pickupDate: Date | string | null | undefined;
  exceptions: PipelineException[];
  /** Latest handoff readiness: true ready, false not ready, null not confirmed. */
  readiness: boolean | null;
  jobStatus?: string | null;
  hasJob: boolean;
};

export type TeamRequestRunFacts = NudgeRunFacts & {
  dropoffDate: Date | string | null | undefined;
  hasSupplier: boolean;
};

const NOT_PICKED_UP = new Set(["PENDING", "CONFIRMED", "FLAGGED"]);

function pickupDue(run: { pickupDate: Date | string | null | undefined }, todayKey: string): boolean {
  const pickupKey = dayKeyOf(run.pickupDate ?? null);
  return pickupKey !== null && pickupKey <= todayKey;
}

/** Cleaner nudges: only bagging / handoff readiness at the property. */
export function laundryNudgeKinds(run: NudgeRunFacts, todayKey: string): LaundryNudgeKind[] {
  if (!run.hasJob || !NOT_PICKED_UP.has(run.status)) return [];
  const codes = new Set(run.exceptions.map((item) => item.code));
  const unconfirmed = run.readiness === null && pickupDue(run, todayKey) && run.jobStatus !== "IN_PROGRESS";
  return codes.has("NOT_READY") || unconfirmed ? ["ASK_CLEANER"] : [];
}

/** Requests to the laundry partner's team, most pressing first. */
export function laundryTeamRequestKinds(run: TeamRequestRunFacts, todayKey: string): LaundryTeamRequestKind[] {
  if (!run.hasSupplier) return [];
  const codes = new Set(run.exceptions.map((item) => item.code));
  const kinds: LaundryTeamRequestKind[] = [];
  if (NOT_PICKED_UP.has(run.status) && run.readiness !== false && !codes.has("NOT_READY") && (codes.has("PICKUP_OVERDUE") || (pickupDue(run, todayKey) && run.readiness === true))) {
    kinds.push("TEAM_CONFIRM_PICKUP");
  }
  // The bags are not out yet on the pickup day (the clean is late or the
  // cleaner said not ready): ask whether the pickup can move later.
  if (NOT_PICKED_UP.has(run.status) && pickupDue(run, todayKey) && run.readiness !== true) {
    kinds.push("TEAM_MOVE_PICKUP");
  }
  // At the laundry, picked up or marked "Ready to return" (2026-11-13).
  if (isAtLaundryStatus(run.status)) {
    if (codes.has("OVER_TURNAROUND") || codes.has("DROP_OVERDUE")) kinds.push("TEAM_RETURN_ETA");
    const dropKey = dayKeyOf(run.dropoffDate ?? null);
    if (dropKey !== null && dropKey <= todayKey) kinds.push("TEAM_CONFIRM_DROP");
  }
  if (codes.has("NO_DROP_PHOTO")) kinds.push("TEAM_PHOTO");
  return kinds;
}

/**
 * The run's partner team as the screens see it. Null when the run has no
 * supplier. `deliverer` is the team member who recorded the drop-off when
 * they are on that team (the photo request goes to them alone).
 */
export type SupplierTeamSummary = { supplierName: string; count: number; names: string[]; deliverer?: string | null } | null;

/** Request kinds that go to the person who delivered rather than the whole team. */
export function goesToDeliverer(kind: LaundryTeamRequestKind, team: SupplierTeamSummary): boolean {
  return kind === "TEAM_PHOTO" && Boolean(team?.deliverer);
}

/** "To CleanCo: Tom, Mia, Dev" / "To Mia Wong, who delivered", as drawn. */
export function teamRequestToLine(kind: LaundryTeamRequestKind, team: SupplierTeamSummary): string {
  if (!team) return "No laundry partner recorded";
  if (goesToDeliverer(kind, team)) return `To ${team.deliverer}, who delivered`;
  if (team.count === 0) return `${team.supplierName} has no portal logins`;
  return `To ${team.supplierName}: ${team.names.join(", ")}`;
}

/** Null when the team can be asked, otherwise why not (the button is disabled with this). */
export function teamRequestBlockedReason(team: SupplierTeamSummary): string | null {
  if (!team) return "No laundry partner is recorded for this run.";
  if (team.count === 0) return `${team.supplierName} has no laundry portal users linked. Link them in Inventory › Suppliers, or use Chase supplier.`;
  return null;
}

/**
 * The idempotency key for a request: the same run, kind and cool-down window
 * give the same key, so a double click or a retry after "no answer" is one
 * request, and the server's cool-down answers anything else in the window.
 */
export function nudgeIdempotencyKey(taskId: string, kind: LaundryNudgeKind | LaundryTeamRequestKind, nowMs: number): string {
  const windowIndex = Math.floor(nowMs / (NUDGE_COOL_DOWN_MINUTES * 60_000));
  return `nudge:${taskId}:${kind}:${windowIndex}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}
