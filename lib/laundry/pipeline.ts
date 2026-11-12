/**
 * Laundry Pipeline rules: which lane a run is in on a chosen Sydney day, and
 * which exceptions it carries. PURE (no database, clock passed in) and tested.
 *
 * Lanes for day D (today T):
 *   To pick up    not yet picked up (PENDING, CONFIRMED, FLAGGED) with pickup on D;
 *                 on today's view also every earlier pickup still not done (carried in).
 *   At the laundry PICKED_UP, picked up on or before D, drop-off after D.
 *   To drop       PICKED_UP with drop-off on D; on today's view also every earlier
 *                 drop-off still not done (carried in).
 *   Delivered     DROPPED, delivered on D (delivery time, or the planned drop-off day
 *                 when no delivery time was recorded).
 *   SKIPPED_PICKUP runs are in no lane (no pickup needed); they stay browsable in
 *   the Completed history, as before.
 *
 * Dates compare as Sydney calendar days (`sydneyDateKey`), which reads both the
 * planner's UTC-midnight dates and Sydney-midnight instants as the same day,
 * across daylight-saving changes.
 *
 * Exceptions (only what the data states):
 *   FLAGGED            status FLAGGED (with its recorded reason)
 *   FAILED_PICKUP      a failed-pickup request is waiting for a decision
 *   NOT_READY          the latest handoff says the linen was not ready
 *   PICKUP_OVERDUE     not picked up and the pickup day has passed
 *   DROP_OVERDUE       picked up and the drop-off day has passed
 *   OVER_TURNAROUND    at the laundry longer than the supplier's average turnaround
 *                      (hours, when the supplier has one); with no supplier figure,
 *                      longer than the Laundry operations "max outdoor days" setting
 *   NO_DROP_PHOTO      delivered without a drop-off photo while the setting requires one
 */
import { sydneyDateKey } from "@/lib/time/sydney-range";

export const PIPELINE_LANES = ["pickup", "laundry", "drop", "delivered"] as const;
export type PipelineLane = (typeof PIPELINE_LANES)[number];

export const PIPELINE_LANE_LABELS: Record<PipelineLane, string> = {
  pickup: "To pick up",
  laundry: "At the laundry",
  drop: "To drop today",
  delivered: "Delivered",
};

export type PipelineConfirmation = {
  laundryReady: boolean | null;
  photoUrl?: string | null;
  notes?: string | null;
  createdAt: Date | string;
};

export type PipelineTaskInput = {
  status: string;
  pickupDate: Date | string;
  dropoffDate: Date | string;
  pickedUpAt?: Date | string | null;
  droppedAt?: Date | string | null;
  flagReason?: string | null;
  supplier?: { avgTurnaround?: number | null } | null;
  confirmations?: PipelineConfirmation[] | null;
};

export type PipelineSettings = { maxOutdoorDays: number; requireDropoffPhoto: boolean };

export type PipelineExceptionCode =
  | "FLAGGED"
  | "FAILED_PICKUP"
  | "NOT_READY"
  | "PICKUP_OVERDUE"
  | "DROP_OVERDUE"
  | "OVER_TURNAROUND"
  | "NO_DROP_PHOTO";

export type PipelineException = { code: PipelineExceptionCode; label: string };

const NOT_PICKED_UP = new Set(["PENDING", "CONFIRMED", "FLAGGED"]);

export function dayKeyOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : sydneyDateKey(date);
}

/** Whole calendar days from key a to key b (b - a). */
export function daysBetweenKeys(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type LanePlacement = { lane: PipelineLane; carriedIn: boolean };

export function classifyLane(task: PipelineTaskInput, dayKey: string, todayKey: string): LanePlacement | null {
  const pickupKey = dayKeyOf(task.pickupDate);
  const dropKey = dayKeyOf(task.dropoffDate);
  const isToday = dayKey === todayKey;

  if (task.status === "DROPPED") {
    const deliveredKey = dayKeyOf(task.droppedAt) ?? dropKey;
    return deliveredKey === dayKey ? { lane: "delivered", carriedIn: false } : null;
  }
  if (NOT_PICKED_UP.has(task.status)) {
    if (!pickupKey) return null;
    if (pickupKey === dayKey) return { lane: "pickup", carriedIn: false };
    if (isToday && pickupKey < dayKey) return { lane: "pickup", carriedIn: true };
    return null;
  }
  if (task.status === "PICKED_UP") {
    if (!dropKey) return null;
    if (dropKey === dayKey) return { lane: "drop", carriedIn: false };
    if (dropKey < dayKey) return isToday ? { lane: "drop", carriedIn: true } : null;
    const pickedKey = dayKeyOf(task.pickedUpAt) ?? pickupKey;
    if (pickedKey && pickedKey <= dayKey) return { lane: "laundry", carriedIn: false };
    return null;
  }
  return null;
}

function parseNotes(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed: unknown = JSON.parse(notes);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function prettify(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function hasPendingFailedPickup(confirmations: readonly PipelineConfirmation[]): boolean {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const meta = parseNotes(confirmations[index].notes);
    if (meta.event === "FAILED_PICKUP_REQUEST") return meta.approvalStatus === "PENDING";
  }
  return false;
}

export function hasDropPhoto(confirmations: readonly PipelineConfirmation[]): boolean {
  return confirmations.some((row) => {
    const meta = parseNotes(row.notes);
    return meta.event === "DROPPED" && Boolean(row.photoUrl || (typeof meta.dropoffPhotoKey === "string" && meta.dropoffPhotoKey));
  });
}

/**
 * The latest cleaner handoff's readiness, if any. Cleaner handoffs are the
 * confirmations without an `event` (the rule lib/laundry/investigation uses).
 */
export function latestReadiness(confirmations: readonly PipelineConfirmation[]): boolean | null {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const row = confirmations[index];
    const event = parseNotes(row.notes).event;
    if ((event === undefined || event === "" || event === null) && typeof row.laundryReady === "boolean") return row.laundryReady;
  }
  return null;
}

/** The most recent bag count recorded on any handoff (cleaner or driver), if any. */
export function latestBagCount(confirmations: readonly PipelineConfirmation[]): number | null {
  for (let index = confirmations.length - 1; index >= 0; index -= 1) {
    const meta = parseNotes(confirmations[index].notes);
    const value = typeof meta.bagCount === "number" ? meta.bagCount : typeof meta.laundryBagCount === "number" ? meta.laundryBagCount : null;
    if (value !== null && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function detectExceptions(
  task: PipelineTaskInput,
  context: { todayKey: string; now: Date; settings: PipelineSettings },
): PipelineException[] {
  const out: PipelineException[] = [];
  const confirmations = task.confirmations ?? [];
  const pickupKey = dayKeyOf(task.pickupDate);
  const dropKey = dayKeyOf(task.dropoffDate);
  const notPickedUp = NOT_PICKED_UP.has(task.status);

  if (task.status === "FLAGGED") {
    out.push({ code: "FLAGGED", label: task.flagReason ? `Flagged: ${prettify(task.flagReason)}` : "Flagged" });
  }
  if (notPickedUp && hasPendingFailedPickup(confirmations)) {
    out.push({ code: "FAILED_PICKUP", label: "Failed pickup, awaiting decision" });
  }
  if (notPickedUp && latestReadiness(confirmations) === false) {
    out.push({ code: "NOT_READY", label: "Not ready" });
  }
  if (notPickedUp && pickupKey && pickupKey < context.todayKey) {
    out.push({ code: "PICKUP_OVERDUE", label: `Pickup overdue ${daysBetweenKeys(pickupKey, context.todayKey)} d` });
  }
  if (task.status === "PICKED_UP") {
    if (dropKey && dropKey < context.todayKey) {
      out.push({ code: "DROP_OVERDUE", label: `Drop overdue ${daysBetweenKeys(dropKey, context.todayKey)} d` });
    }
    const pickedMs = timeOf(task.pickedUpAt);
    if (pickedMs !== null) {
      const hoursOut = (context.now.getTime() - pickedMs) / 3_600_000;
      const supplierHours = task.supplier?.avgTurnaround;
      if (typeof supplierHours === "number" && supplierHours > 0) {
        if (hoursOut > supplierHours) out.push({ code: "OVER_TURNAROUND", label: `Over the supplier's ${supplierHours} h turnaround` });
      } else if (hoursOut > context.settings.maxOutdoorDays * 24) {
        out.push({ code: "OVER_TURNAROUND", label: `Out over ${context.settings.maxOutdoorDays} days` });
      }
    }
  }
  if (task.status === "DROPPED" && context.settings.requireDropoffPhoto && !hasDropPhoto(confirmations)) {
    out.push({ code: "NO_DROP_PHOTO", label: "No drop photo" });
  }
  return out;
}

// ── Tabs ───────────────────────────────────────────────────────────────────

export const LAUNDRY_TABS = ["pipeline", "property", "live", "costs", "suppliers", "statistics"] as const;
export type LaundryTab = (typeof LAUNDRY_TABS)[number];

export const LAUNDRY_TAB_LABELS: Record<LaundryTab, string> = {
  pipeline: "Pipeline",
  property: "By property",
  live: "Drivers live",
  costs: "Costs and invoices",
  suppliers: "Suppliers",
  statistics: "Statistics",
};

export type PipelineView = "board" | "completed";

/**
 * Old tab ids keep working: Active runs ("today") and Completed both land on
 * the Pipeline (Completed opens its history view); Investigate → By property;
 * Live → Drivers live; Reports → Costs and invoices.
 */
export function resolveLaundryTab(value: string | null | undefined): { tab: LaundryTab; view: PipelineView } | null {
  switch (value) {
    case "pipeline":
    case "today":
    case "active":
      return { tab: "pipeline", view: "board" };
    case "completed":
      return { tab: "pipeline", view: "completed" };
    case "property":
    case "investigate":
      return { tab: "property", view: "board" };
    case "live":
      return { tab: "live", view: "board" };
    case "costs":
    case "reports":
      return { tab: "costs", view: "board" };
    case "suppliers":
      return { tab: "suppliers", view: "board" };
    case "statistics":
    case "stats":
      return { tab: "statistics", view: "board" };
    default:
      return null;
  }
}

/** Polling (30 s and on focus) runs only on these tabs. */
export const LIVE_LAUNDRY_TABS: ReadonlySet<LaundryTab> = new Set<LaundryTab>(["pipeline", "live"]);
