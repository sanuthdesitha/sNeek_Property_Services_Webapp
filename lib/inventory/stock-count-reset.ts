/**
 * Applied stock counts when a job is reset (owner decision 2026-11-12).
 *
 * A Stock count answer on a job form sets on-hand when the clean is approved
 * (lib/inventory/stock-count-observations.ts, status APPLIED). When that job
 * is later reset (Reset job, QA reset, a status edit or a bulk status change
 * out of Completed) the office is asked whether to reverse those counts:
 *
 * - Every human reset path lists the job's APPLIED counts and must pass an
 *   explicit choice, "REVERSE" or "KEEP". Without one the service throws
 *   StockCountChoiceRequiredError (routes answer 409 naming the counts), so
 *   no caller can silently skip the question.
 * - REVERSE restores the on-hand value the count replaced (the observation's
 *   `previousOnHand`) only when nothing newer has happened on that item: no
 *   stock movement after the count's own ledger row, and on-hand still equal
 *   to the counted value. Otherwise the item is "not reversed: newer record"
 *   and left alone. A reversal writes its own ADJUSTED ledger row (not linked
 *   to the submission, so it survives a later "Clear form data") and marks
 *   the observation REVERSED with the reason; nothing is deleted.
 * - KEEP leaves on-hand and the observation as they are and records the
 *   decision on the observation and in the audit row.
 * - Paths with no person deciding (a QA verdict recomputed after a score
 *   change) keep the counts and record that no choice was made.
 *
 * Every decision writes one audit row with the acting account, its role and,
 * while impersonating, the administrator behind it.
 */
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Prisma.TransactionClient, "stockCountObservation" | "propertyStock">;

export const APPLIED_COUNT_CHOICES = ["REVERSE", "KEEP"] as const;
export type AppliedCountChoice = (typeof APPLIED_COUNT_CHOICES)[number];

export const STOCK_COUNT_CHOICE_REQUIRED = "STOCK_COUNT_CHOICE_REQUIRED";

/** One applied count as the reset dialogs show it. */
export type AppliedStockCount = {
  observationId: string;
  itemId: string;
  itemName: string;
  label: string;
  unit: string | null;
  /** The counted value that was applied to on-hand. */
  count: number;
  /** On-hand before the count was applied; null when unknown (never shown as zero). */
  previousOnHand: number | null;
  /** On-hand now; null when the property no longer stocks the item. */
  onHandNow: number | null;
  appliedAt: string | null;
};

export type ResetCountOutcomeKind = "REVERSED" | "KEPT" | "NOT_REVERSED_NEWER_RECORD" | "NOT_REVERSED_NO_PRIOR_VALUE";

export type ResetCountOutcome = {
  observationId: string;
  itemId: string;
  itemName: string;
  outcome: ResetCountOutcomeKind;
  onHandBefore: number | null;
  onHandAfter: number | null;
  detail: string;
};

export type ResetCountResolution = {
  choice: AppliedCountChoice | "NONE";
  outcomes: ResetCountOutcome[];
};

export type ResetActor = { id: string; role: string; impersonatedBy?: string | null };

/** Thrown when applied counts exist and the caller did not say what to do with them. */
export class StockCountChoiceRequiredError extends Error {
  readonly code = STOCK_COUNT_CHOICE_REQUIRED;
  constructor(public readonly counts: AppliedStockCount[]) {
    super(stockCountChoiceMessage(counts));
    this.name = "StockCountChoiceRequiredError";
  }
}

/** Pure: "REVERSE" / "KEEP" from a request body, anything else null. */
export function parseAppliedCountChoice(value: unknown): AppliedCountChoice | null {
  return value === "REVERSE" || value === "KEEP" ? value : null;
}

function formatQuantity(value: number | null, unit: string | null): string {
  if (value === null) return "unknown";
  return unit ? `${value} ${unit}` : String(value);
}

/** Pure: the message naming every applied count. */
export function stockCountChoiceMessage(counts: AppliedStockCount[]): string {
  const named = counts.map((row) => `${row.itemName} (counted ${formatQuantity(row.count, row.unit)}, on hand now ${formatQuantity(row.onHandNow, row.unit)})`).join("; ");
  return `Stock counts from this job were already applied to on-hand stock: ${named}. Choose "Reverse these counts" or "Keep them" before resetting.`;
}

/** Pure: the 409 body every reset route returns when the choice is missing. */
export function stockCountChoiceRequiredBody(counts: AppliedStockCount[]) {
  return { code: STOCK_COUNT_CHOICE_REQUIRED, error: stockCountChoiceMessage(counts), appliedStockCounts: counts };
}

/**
 * Pure: may a count be reversed? Only when no stock movement was recorded
 * after it and on-hand still equals the counted value (a change without a
 * ledger row is still a newer record), and the replaced value is known.
 */
export function reversalDisposition(input: { countedValue: number; onHandNow: number; previousOnHand: number | null; newerMovementAt: Date | null }): "REVERSE" | "NEWER_RECORD" | "NO_PRIOR_VALUE" {
  if (input.newerMovementAt) return "NEWER_RECORD";
  if (input.onHandNow !== input.countedValue) return "NEWER_RECORD";
  if (input.previousOnHand === null || !Number.isFinite(input.previousOnHand)) return "NO_PRIOR_VALUE";
  return "REVERSE";
}

/** The job's counts that are currently applied to on-hand (status APPLIED). */
export async function listAppliedStockCounts(reader: Reader, jobId: string): Promise<AppliedStockCount[]> {
  const observations = await reader.stockCountObservation.findMany({
    where: { jobId, status: "APPLIED" },
    orderBy: [{ itemName: "asc" }, { id: "asc" }],
  });
  if (observations.length === 0) return [];
  const stocks = await reader.propertyStock.findMany({
    where: { OR: observations.map((row) => ({ propertyId: row.propertyId, itemId: row.itemId })) },
    select: { propertyId: true, itemId: true, onHand: true },
  });
  const onHandByPair = new Map(stocks.map((row) => [`${row.propertyId}:${row.itemId}`, row.onHand]));
  return observations.map((row) => ({
    observationId: row.id,
    itemId: row.itemId,
    itemName: row.itemName ?? row.label,
    label: row.label,
    unit: row.unit,
    count: row.count,
    previousOnHand: row.previousOnHand,
    onHandNow: onHandByPair.get(`${row.propertyId}:${row.itemId}`) ?? null,
    appliedAt: row.resolvedAt?.toISOString() ?? null,
  }));
}

/** Throws StockCountChoiceRequiredError when applied counts exist and no choice was given. */
export async function assertStockCountChoice(reader: Reader, jobId: string, choice: AppliedCountChoice | null): Promise<AppliedStockCount[]> {
  const counts = await listAppliedStockCounts(reader, jobId);
  if (counts.length > 0 && !choice) throw new StockCountChoiceRequiredError(counts);
  return counts;
}

function actorLabel(actor: ResetActor): string {
  return actor.impersonatedBy ? `${actor.id} (${actor.role}, impersonated by ${actor.impersonatedBy})` : `${actor.id} (${actor.role})`;
}

async function reverseOne(tx: Tx, observation: Prisma.StockCountObservationGetPayload<object>, input: { jobReference: string; path: string; actor: ResetActor; now: Date }): Promise<ResetCountOutcome> {
  const base = { observationId: observation.id, itemId: observation.itemId, itemName: observation.itemName ?? observation.label };
  const stock = await tx.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId: observation.propertyId, itemId: observation.itemId } } });
  if (!stock) {
    const detail = "Not reversed: the property no longer stocks this item.";
    await tx.stockCountObservation.update({ where: { id: observation.id }, data: { reason: `${detail} (reset by ${actorLabel(input.actor)}, ${input.path}, ${input.now.toISOString()})` } });
    return { ...base, outcome: "NOT_REVERSED_NEWER_RECORD", onHandBefore: null, onHandAfter: null, detail };
  }
  const appliedLedger = observation.stockTxId
    ? await tx.stockTx.findUnique({ where: { id: observation.stockTxId }, select: { id: true, createdAt: true } })
    : null;
  const appliedAt = appliedLedger?.createdAt ?? observation.resolvedAt ?? observation.observedAt;
  const newer = await tx.stockTx.findFirst({
    where: { propertyStockId: stock.id, createdAt: { gte: appliedAt }, ...(appliedLedger ? { id: { not: appliedLedger.id } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const disposition = reversalDisposition({ countedValue: observation.count, onHandNow: stock.onHand, previousOnHand: observation.previousOnHand, newerMovementAt: newer?.createdAt ?? null });
  const stamp = `reset by ${actorLabel(input.actor)}, ${input.path}, ${input.now.toISOString()}`;
  if (disposition === "NEWER_RECORD") {
    const detail = newer
      ? `Not reversed: a newer stock record (${newer.createdAt.toISOString()}) exists for this item; on-hand left at ${stock.onHand}.`
      : `Not reversed: on-hand changed since the count (now ${stock.onHand}, counted ${observation.count}); left as it is.`;
    await tx.stockCountObservation.update({ where: { id: observation.id }, data: { reason: `${detail} (${stamp})` } });
    return { ...base, outcome: "NOT_REVERSED_NEWER_RECORD", onHandBefore: stock.onHand, onHandAfter: stock.onHand, detail };
  }
  if (disposition === "NO_PRIOR_VALUE") {
    const detail = "Not reversed: the on-hand value this count replaced was not recorded.";
    await tx.stockCountObservation.update({ where: { id: observation.id }, data: { reason: `${detail} (${stamp})` } });
    return { ...base, outcome: "NOT_REVERSED_NO_PRIOR_VALUE", onHandBefore: stock.onHand, onHandAfter: stock.onHand, detail };
  }
  const restored = observation.previousOnHand as number;
  await tx.propertyStock.update({ where: { id: stock.id }, data: { onHand: restored, updatedAt: input.now } });
  const ledger = await tx.stockTx.create({
    data: {
      propertyStockId: stock.id,
      submissionId: null,
      txType: "ADJUSTED",
      quantity: restored - stock.onHand,
      notes: `Reversed the stock count from the job form of ${input.jobReference} ("${observation.label}", counted ${observation.count}) when the job was reset; on-hand restored to ${restored}.`,
      createdAt: input.now,
    },
    select: { id: true },
  });
  const detail = `Reversed: on-hand restored from ${stock.onHand} to ${restored}.`;
  await tx.stockCountObservation.update({
    where: { id: observation.id },
    data: { status: "REVERSED", resolvedAt: input.now, reason: `${detail} Reversal ledger ${ledger.id} (${stamp}).` },
  });
  return { ...base, outcome: "REVERSED", onHandBefore: stock.onHand, onHandAfter: restored, detail };
}

/**
 * Apply the office's choice to the job's applied counts, inside the reset
 * transaction. Requires a choice when applied counts exist.
 */
export async function resolveAppliedCountsOnReset(tx: Tx, input: { jobId: string; choice: AppliedCountChoice | null; actor: ResetActor; path: string; now?: Date }): Promise<ResetCountResolution> {
  const now = input.now ?? new Date();
  const listed = await assertStockCountChoice(tx, input.jobId, input.choice);
  if (listed.length === 0 || !input.choice) return { choice: input.choice ?? "NONE", outcomes: [] };
  const job = await tx.job.findUnique({ where: { id: input.jobId }, select: { jobNumber: true } });
  const jobReference = job?.jobNumber ?? input.jobId;
  const outcomes: ResetCountOutcome[] = [];
  for (const row of listed) {
    const observation = await tx.stockCountObservation.findUnique({ where: { id: row.observationId } });
    if (!observation) continue;
    await tx.$queryRaw`SELECT "id" FROM "PropertyStock" WHERE "propertyId" = ${observation.propertyId} AND "itemId" = ${observation.itemId} FOR UPDATE`;
    const fresh = await tx.stockCountObservation.findUnique({ where: { id: observation.id } });
    if (fresh?.status !== "APPLIED") continue;
    if (input.choice === "KEEP") {
      const detail = "Kept: the office chose to keep this count when the job was reset.";
      await tx.stockCountObservation.update({ where: { id: fresh.id }, data: { reason: `${detail} (reset by ${actorLabel(input.actor)}, ${input.path}, ${now.toISOString()})` } });
      outcomes.push({ observationId: fresh.id, itemId: fresh.itemId, itemName: fresh.itemName ?? fresh.label, outcome: "KEPT", onHandBefore: row.onHandNow, onHandAfter: row.onHandNow, detail });
      continue;
    }
    outcomes.push(await reverseOne(tx, fresh, { jobReference, path: input.path, actor: input.actor, now }));
  }
  await tx.auditLog.create({
    data: {
      userId: input.actor.id,
      jobId: input.jobId,
      action: "STOCK_COUNTS_RESET_DECISION",
      entity: "Job",
      entityId: input.jobId,
      after: { path: input.path, choice: input.choice, actorRole: input.actor.role, impersonatedBy: input.actor.impersonatedBy ?? null, outcomes } as unknown as Prisma.InputJsonValue,
    },
  });
  return { choice: input.choice, outcomes };
}

const APPROVED_STATUSES = ["COMPLETED", "INVOICED"];

/**
 * A path that takes a job out of Completed without anyone being asked (a QA
 * verdict recomputed after a score changed): the counts stay applied and the
 * observation records that no choice was made. Audited when a person caused
 * it (`actorId`); the reason on the observation is written either way.
 */
export async function keepAppliedCountsWithoutChoice(tx: Tx, input: { jobId: string; fromStatus: string; toStatus: string; path: string; actorId?: string | null; now?: Date }): Promise<number> {
  if (!APPROVED_STATUSES.includes(input.fromStatus) || APPROVED_STATUSES.includes(input.toStatus)) return 0;
  const counts = await listAppliedStockCounts(tx, input.jobId);
  if (counts.length === 0) return 0;
  const now = input.now ?? new Date();
  const reason = `Kept: the job left approval (${input.path}, ${now.toISOString()}) without an office choice; nobody was asked to reverse this count.`;
  await tx.stockCountObservation.updateMany({ where: { id: { in: counts.map((row) => row.observationId) }, status: "APPLIED" }, data: { reason } });
  if (input.actorId) {
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        jobId: input.jobId,
        action: "STOCK_COUNTS_KEPT_NO_CHOICE",
        entity: "Job",
        entityId: input.jobId,
        after: { path: input.path, fromStatus: input.fromStatus, toStatus: input.toStatus, observationIds: counts.map((row) => row.observationId) },
      },
    });
  }
  return counts.length;
}
