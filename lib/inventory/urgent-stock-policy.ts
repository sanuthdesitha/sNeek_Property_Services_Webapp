import { z } from "zod";

// A missing count and a requested purchase quantity describe different facts.
// Neither one is inferred from the other or coerced to zero.
export const urgentStockReportInput = z.object({
  propertyId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  requestId: z.string().uuid(),
  observedCount: z.number().finite().nonnegative().max(1_000_000).nullable(),
  purchaseQuantity: z.number().finite().positive().max(1_000_000).nullable(),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().trim().min(1).max(2000),
}).strict().superRefine((value, context) => {
  if (value.observedCount !== null && value.observedAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["observedAt"], message: "Record when the count was observed." });
  }
});

export const URGENT_STOCK_STAGES = ["REPORTED", "ACKNOWLEDGED", "ORDERED", "DELIVERED", "PROPERTY_CONFIRMED", "ADMIN_RESOLVED"] as const;
export type UrgentStockStage = typeof URGENT_STOCK_STAGES[number];
export const isUrgentStockClosed = (stage: UrgentStockStage) => stage === "PROPERTY_CONFIRMED" || stage === "ADMIN_RESOLVED";

export type StockConfirmation = {
  observedCount: number | null;
  observationApplied: boolean;
  needResolved: boolean;
  reason: string;
};

/** Validate a recorded action; this never places an order or changes stock. */
export function validateUrgentStockTransition(input: {
  from: UrgentStockStage;
  to: UrgentStockStage;
  isAdmin: boolean;
  reason: string;
  confirmation?: StockConfirmation;
}): void {
  if (isUrgentStockClosed(input.from)) throw new Error("This report is already closed. Create a new report for a new need.");
  if (!input.reason.trim() || input.reason.length > 2000) throw new Error("Record a reason for this action.");
  if (input.to === "ADMIN_RESOLVED") {
    if (!input.isAdmin) throw new Error("Only an administrator can explicitly resolve an unconfirmed need.");
    return;
  }
  if (input.to === "PROPERTY_CONFIRMED") {
    const proof = input.confirmation;
    if (!proof || !proof.observationApplied || proof.observedCount === null || !Number.isFinite(proof.observedCount) || proof.observedCount <= 0 || !proof.needResolved || !proof.reason.trim()) {
      throw new Error("Confirm a fresh positive property count and that the reported need is resolved.");
    }
    return;
  }
  const next: Partial<Record<UrgentStockStage, UrgentStockStage>> = {
    REPORTED: "ACKNOWLEDGED", ACKNOWLEDGED: "ORDERED", ORDERED: "DELIVERED",
  };
  if (next[input.from] !== input.to) throw new Error("Record each supply stage in order.");
}

/** A count must postdate every inventory write; late observations remain history. */
export function countObservationDisposition(input: {
  count: number | null;
  observedAt: Date | null;
  recordedAt: Date;
  stockUpdatedAt: Date | null;
  latestLedgerAt: Date | null;
}): "UNKNOWN" | "FUTURE" | "STALE" | "APPLY" {
  if (input.count === null) return "UNKNOWN";
  if (!Number.isFinite(input.count) || input.count < 0 || !input.observedAt || !Number.isFinite(input.observedAt.getTime())) throw new Error("A valid count and observation time are required.");
  if (input.observedAt > input.recordedAt) return "FUTURE";
  if (input.recordedAt.getTime() - input.observedAt.getTime() > 24 * 3_600_000) return "STALE";
  const newestWrite = Math.max(input.stockUpdatedAt?.getTime() ?? -Infinity, input.latestLedgerAt?.getTime() ?? -Infinity);
  return input.observedAt.getTime() <= newestWrite ? "STALE" : "APPLY";
}

export const urgentStockReminderSettings = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  maxReminders: z.number().int().min(0).max(20),
  beforeNextCleanHours: z.number().int().min(1).max(168),
}).strict();

/** Recomputed deadlines may advance a reminder, but never bypass the hourly cap. */
export function urgentStockReminderDue(input: {
  settings: z.infer<typeof urgentStockReminderSettings>;
  stage: UrgentStockStage;
  now: Date;
  createdAt: Date;
  lastReminderAt: Date | null;
  remindersSent: number;
  nextCleanAt: Date | null;
}): boolean {
  const settings = urgentStockReminderSettings.parse(input.settings);
  if (!settings.enabled || isUrgentStockClosed(input.stage) || input.remindersSent >= settings.maxReminders) return false;
  const last = input.lastReminderAt ?? input.createdAt;
  const elapsed = input.now.getTime() - last.getTime();
  if (elapsed < 3_600_000) return false;
  const nearClean = input.nextCleanAt !== null && input.nextCleanAt.getTime() - input.now.getTime() <= settings.beforeNextCleanHours * 3_600_000;
  return elapsed >= settings.intervalHours * 3_600_000 || nearClean;
}
