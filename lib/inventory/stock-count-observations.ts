/**
 * Stock count answers on job forms set on-hand stock (Wave F, carried from
 * Wave B): a real count-observation path.
 *
 * 1. At submission (inside the submit transaction) every Stock count answer
 *    becomes a StockCountObservation for that property's item, status PENDING,
 *    with the source submission. Once per submission and item (unique key).
 *    An item the property does not stock, or an inactive / unknown item, is
 *    NEEDS_REVIEW with the reason, and the office is told in its inbox: it is
 *    never dropped and never guessed onto another item.
 * 2. Nothing changes on-hand while the clean is waiting for approval.
 * 3. When the clean is approved (the approval paths all call
 *    applyJobRotationCompletion, which calls applyApprovedStockCounts), the
 *    latest submission's PENDING observations are applied: on-hand is SET to
 *    the counted number with an ADJUSTED ledger row linked to the submission,
 *    unless a newer stock movement was recorded after the count was made (an
 *    office count, delivery, restock or adjustment): then SKIPPED_NEWER, kept as
 *    history with the reason. Never applied twice (status changes under the
 *    stock row lock).
 * 4. A new submission of the same job (after a reset or rework) supersedes the
 *    earlier submission's PENDING / NEEDS_REVIEW observations (SUPERSEDED: when
 *    the new submission records counts, and in any case at approval). An
 *    already APPLIED count stays as the history it is; the newer submission's
 *    count applies on its own approval.
 * 5. When the job is reset after a count was applied, the office chooses to
 *    reverse or keep it (lib/inventory/stock-count-reset.ts, owner decision
 *    2026-11-12). A REVERSED count is never applied again.
 */
import { Prisma, Role } from "@prisma/client";
import type { StockCountObservation as FormStockCount } from "@/lib/forms/form-effects";
import { queueDelivery } from "@/lib/notifications/queue-delivery";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

type Tx = Prisma.TransactionClient;

/** REVERSED (owner decision 2026-11-12): an applied count the office reversed when the job was reset (lib/inventory/stock-count-reset.ts). */
export const COUNT_OBSERVATION_STATUSES = ["PENDING", "APPLIED", "SKIPPED_NEWER", "NEEDS_REVIEW", "REVIEWED", "SUPERSEDED", "REVERSED"] as const;
export type CountObservationStatus = (typeof COUNT_OBSERVATION_STATUSES)[number];

export const NOT_STOCKED_REASON = "This property does not stock this item, so the count cannot set its on-hand. Add the item to the property's stock or check the form's item.";
export const UNKNOWN_ITEM_REASON = "The form's item is no longer an active catalogue item, so the count cannot set on-hand. Check the form question's item.";

/**
 * Pure: a count's fate when the clean is approved. `latestOtherLedgerAt` is the
 * newest stock movement for the item NOT written by the same submission (the
 * submission's own usage rows are older than its final count by definition).
 * PropertyStock.updatedAt is not used: it also moves for par-level edits,
 * which are not counts.
 */
export function approvedCountDisposition(input: { observedAt: Date; latestOtherLedgerAt: Date | null }): "APPLY" | "SKIPPED_NEWER" {
  if (!input.latestOtherLedgerAt) return "APPLY";
  return input.latestOtherLedgerAt.getTime() >= input.observedAt.getTime() ? "SKIPPED_NEWER" : "APPLY";
}

export type RecordCountsInput = { submissionId: string; jobId: string; propertyId: string; observedAt: Date; counts: FormStockCount[] };

/** Step 1, inside the submit transaction. Returns how many need review. */
export async function recordStockCountObservations(tx: Tx, input: RecordCountsInput): Promise<{ recorded: number; needsReview: number }> {
  const now = new Date();
  await tx.stockCountObservation.updateMany({
    where: { jobId: input.jobId, submissionId: { not: input.submissionId }, status: { in: ["PENDING", "NEEDS_REVIEW"] } },
    data: { status: "SUPERSEDED", reason: "A newer submission of this job replaced this count.", resolvedAt: now },
  });
  if (input.counts.length === 0) return { recorded: 0, needsReview: 0 };
  const itemIds = Array.from(new Set(input.counts.map((count) => count.itemId)));
  const [stocked, items] = await Promise.all([
    tx.propertyStock.findMany({ where: { propertyId: input.propertyId, itemId: { in: itemIds } }, select: { itemId: true } }),
    tx.inventoryItem.findMany({ where: { id: { in: itemIds }, isActive: true }, select: { id: true, name: true } }),
  ]);
  const stockedIds = new Set(stocked.map((row) => row.itemId));
  const activeItems = new Map(items.map((item) => [item.id, item.name]));
  const rows = input.counts.map((count) => {
    const reason = !activeItems.has(count.itemId) ? UNKNOWN_ITEM_REASON : !stockedIds.has(count.itemId) ? NOT_STOCKED_REASON : null;
    return {
      submissionId: input.submissionId, jobId: input.jobId, propertyId: input.propertyId, itemId: count.itemId,
      itemName: activeItems.get(count.itemId) ?? count.itemName, fieldId: count.fieldId, label: count.label, unit: count.unit,
      count: count.count, observedAt: input.observedAt, status: reason ? "NEEDS_REVIEW" : "PENDING", reason,
    };
  });
  const created = await tx.stockCountObservation.createMany({ data: rows, skipDuplicates: true });
  const needsReview = rows.filter((row) => row.status === "NEEDS_REVIEW").length;
  if (needsReview > 0) await queueCountReview(tx, input.jobId, input.submissionId, needsReview);
  return { recorded: created.count, needsReview };
}

async function queueCountReview(tx: Tx, jobId: string, submissionId: string, count: number) {
  const recipients = await tx.user.findMany({ where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true }, select: { id: true, role: true } });
  if (!recipients.length) return;
  const text = (await loadNotificationWording("stock.urgent_need")).render("count-review", "INBOX", { count, answersWord: count === 1 ? "answer" : "answers" });
  await queueDelivery({ recipients, category: "shopping", jobId, web: {
    subject: text.title,
    body: text.body,
  } }, {
    tx, eventId: `stock-count-review:${submissionId}`, eventKey: "submission.stock_count_review", entity: { type: "FormSubmission", id: submissionId },
    actorId: null, severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" }, transports: ["INBOX"],
  });
}

/** Step 3, inside the approval transaction. Idempotent: only PENDING rows of the job's latest submission. */
export async function applyApprovedStockCounts(tx: Tx, input: { jobId: string }): Promise<{ applied: number; skipped: number }> {
  const job = await tx.job.findUnique({ where: { id: input.jobId }, select: { status: true, jobNumber: true } });
  if (!job || !["COMPLETED", "INVOICED"].includes(job.status)) return { applied: 0, skipped: 0 };
  const latest = await tx.formSubmission.findFirst({ where: { jobId: input.jobId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!latest) return { applied: 0, skipped: 0 };
  // Counts of an earlier submission of this job never apply: the approved clean is the latest submission.
  await tx.stockCountObservation.updateMany({
    where: { jobId: input.jobId, submissionId: { not: latest.id }, status: { in: ["PENDING", "NEEDS_REVIEW"] } },
    data: { status: "SUPERSEDED", reason: "A newer submission of this job replaced this count.", resolvedAt: new Date() },
  });
  const pending = await tx.stockCountObservation.findMany({ where: { submissionId: latest.id, status: "PENDING" }, orderBy: { itemId: "asc" } });
  let applied = 0;
  let skipped = 0;
  for (const observation of pending) {
    await tx.$queryRaw`SELECT "id" FROM "PropertyStock" WHERE "propertyId" = ${observation.propertyId} AND "itemId" = ${observation.itemId} FOR UPDATE`;
    const fresh = await tx.stockCountObservation.findUnique({ where: { id: observation.id }, select: { status: true } });
    if (fresh?.status !== "PENDING") continue;
    const stock = await tx.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId: observation.propertyId, itemId: observation.itemId } } });
    const now = new Date();
    if (!stock) {
      await tx.stockCountObservation.update({ where: { id: observation.id }, data: { status: "NEEDS_REVIEW", reason: NOT_STOCKED_REASON, resolvedAt: null } });
      skipped += 1;
      continue;
    }
    const latestTx = await tx.stockTx.findFirst({
      where: { propertyStockId: stock.id, OR: [{ submissionId: null }, { submissionId: { not: observation.submissionId } }] },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const disposition = approvedCountDisposition({ observedAt: observation.observedAt, latestOtherLedgerAt: latestTx?.createdAt ?? null });
    if (disposition === "SKIPPED_NEWER") {
      await tx.stockCountObservation.update({ where: { id: observation.id }, data: { status: "SKIPPED_NEWER", reason: `A newer stock movement was recorded at ${latestTx!.createdAt.toISOString()}, after this count was made; on-hand was not overwritten.`, resolvedAt: now } });
      await settleNeedDisposition(tx, observation, "STALE");
      skipped += 1;
      continue;
    }
    await tx.propertyStock.update({ where: { id: stock.id }, data: { onHand: observation.count, updatedAt: now } });
    const ledger = await tx.stockTx.create({
      data: { propertyStockId: stock.id, submissionId: observation.submissionId, txType: "ADJUSTED", quantity: observation.count - stock.onHand, notes: `Stock count on the job form of ${job.jobNumber ?? input.jobId} ("${observation.label}"), applied on approval; counted ${observation.count}.`, createdAt: now },
      select: { id: true },
    });
    await tx.stockCountObservation.update({ where: { id: observation.id }, data: { status: "APPLIED", previousOnHand: stock.onHand, stockTxId: ledger.id, resolvedAt: now, reason: null } });
    await settleNeedDisposition(tx, observation, "APPLY");
    applied += 1;
  }
  return { applied, skipped };
}

/** An urgent need raised by the same submission said "applied when approved"; now say what happened. */
async function settleNeedDisposition(tx: Tx, observation: { submissionId: string; propertyId: string; itemId: string }, disposition: "APPLY" | "STALE") {
  await tx.urgentStockNeed.updateMany({
    where: { sourceSubmissionId: observation.submissionId, propertyId: observation.propertyId, itemId: observation.itemId, observationDisposition: "PENDING_APPROVAL" },
    data: { observationDisposition: disposition, version: { increment: 1 } },
  });
}
