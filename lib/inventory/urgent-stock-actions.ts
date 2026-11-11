/**
 * What the office can do next with an urgent stock need, and how each stage is
 * worded. Pure: shared by the office table, the need panel, the bulk endpoint
 * and their tests. Wording stays truthful: recording "ordered" or "delivered"
 * is the office's statement, not a purchase or a proof of delivery.
 */
import { isUrgentStockClosed, type UrgentStockStage } from "./urgent-stock-policy";

export const URGENT_STAGE_LABEL: Record<UrgentStockStage, string> = {
  REPORTED: "Reported",
  ACKNOWLEDGED: "Acknowledged",
  ORDERED: "Ordered",
  DELIVERED: "Delivered",
  PROPERTY_CONFIRMED: "Confirmed",
  ADMIN_RESOLVED: "Resolved",
};

/** Longer wording for history lines and the panel ("… by Jane"). */
export const URGENT_STAGE_RECORDED: Record<UrgentStockStage, string> = {
  REPORTED: "Reported",
  ACKNOWLEDGED: "Acknowledged",
  ORDERED: "Marked ordered",
  DELIVERED: "Marked delivered; awaiting confirmation at the property",
  PROPERTY_CONFIRMED: "Confirmed at the property with a fresh count",
  ADMIN_RESOLVED: "Resolved by an administrator",
};

export type UrgentNextAction =
  | { kind: "transition"; to: "ACKNOWLEDGED" | "ORDERED" | "DELIVERED"; label: string; reason: string }
  | { kind: "waiting"; label: string }
  | { kind: "closed"; label: string };

/** Exactly one next step per stage. */
export function urgentNextAction(stage: UrgentStockStage): UrgentNextAction {
  switch (stage) {
    case "REPORTED":
      return { kind: "transition", to: "ACKNOWLEDGED", label: "Acknowledge", reason: "Acknowledged by the office." };
    case "ACKNOWLEDGED":
      return { kind: "transition", to: "ORDERED", label: "Mark ordered", reason: "Marked ordered by the office." };
    case "ORDERED":
      return { kind: "transition", to: "DELIVERED", label: "Mark delivered", reason: "Marked delivered by the office; awaiting confirmation at the property." };
    case "DELIVERED":
      return { kind: "waiting", label: "Waiting for cleaner to confirm" };
    default:
      return { kind: "closed", label: "Closed" };
  }
}

/** The stage chips on the Urgent needs tab. */
export const URGENT_FILTERS = ["open", "REPORTED", "ACKNOWLEDGED", "ORDERED", "DELIVERED", "closed", "all"] as const;
export type UrgentFilter = (typeof URGENT_FILTERS)[number];

export const URGENT_FILTER_LABEL: Record<UrgentFilter, string> = {
  open: "Open",
  REPORTED: "Reported",
  ACKNOWLEDGED: "Acknowledged",
  ORDERED: "Ordered",
  DELIVERED: "Delivered",
  closed: "Closed",
  all: "All",
};

export const CLOSED_STAGES: UrgentStockStage[] = ["PROPERTY_CONFIRMED", "ADMIN_RESOLVED"];

export function stagesForFilter(filter: UrgentFilter): UrgentStockStage[] | null {
  if (filter === "all") return null;
  if (filter === "open") return ["REPORTED", "ACKNOWLEDGED", "ORDERED", "DELIVERED"];
  if (filter === "closed") return CLOSED_STAGES;
  return [filter];
}

/** Bulk actions offered on the tab, each one stage through the single transition service. */
export const URGENT_BULK_ACTIONS = ["acknowledge", "mark-ordered", "close"] as const;
export type UrgentBulkAction = (typeof URGENT_BULK_ACTIONS)[number];

export const URGENT_BULK_TARGET: Record<UrgentBulkAction, UrgentStockStage> = {
  acknowledge: "ACKNOWLEDGED",
  "mark-ordered": "ORDERED",
  close: "ADMIN_RESOLVED",
};

/** Par less the observed count, only when both are known; never a guessed zero. */
export function suggestedBuy(parLevel: number | null, observedCount: number | null): number | null {
  if (parLevel === null || parLevel <= 0 || observedCount === null) return null;
  return Math.max(0, parLevel - observedCount);
}

export type NeededByState = "upcoming" | "passed" | "unknown" | "closed";

/** Needed by = the property's next clean deadline, for open needs only. */
export function neededByState(stage: UrgentStockStage, deadline: Date | null, now: Date): NeededByState {
  if (isUrgentStockClosed(stage)) return "closed";
  if (!deadline) return "unknown";
  return deadline.getTime() < now.getTime() ? "passed" : "upcoming";
}
