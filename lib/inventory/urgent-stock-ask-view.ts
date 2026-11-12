/**
 * How a "buy" ask reads, for the office list and the cleaner's job screen.
 *
 * "Bought" is derived, never stored: the ask was accepted, the cleaner's run
 * was submitted with this item purchased, and the office approved the
 * cleaner's reimbursement (the existing shopping approval). Submitted but not
 * yet approved reads "Bought · awaiting office approval".
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { purchaseAskState, type AskRunFacts, type PurchaseAskState } from "./urgent-stock-ask-state";

export { PURCHASE_ASK_LABEL, purchaseAskState, type PurchaseAskState } from "./urgent-stock-ask-state";

export type CleanerAskRow = {
  id: string;
  state: PurchaseAskState;
  itemName: string;
  unit: string;
  quantity: number | null;
  propertyName: string;
  jobId: string | null;
  note: string | null;
  askedByName: string;
  askedAt: string;
  runId: string | null;
};

/** The cleaner's waiting and accepted asks: for one job (and its property), or all of them. */
export async function listCleanerPurchaseAsks(cleaner: { id: string; role: Role }, jobId: string | null): Promise<CleanerAskRow[]> {
  if (cleaner.role !== Role.CLEANER) throw new Error("FORBIDDEN");
  let propertyId: string | null = null;
  if (jobId) {
    const job = await db.job.findFirst({ where: { id: jobId, assignments: { some: { userId: cleaner.id, removedAt: null } } }, select: { propertyId: true } });
    if (!job) throw new Error("NOT_FOUND");
    propertyId = job.propertyId;
  }
  const asks = await db.urgentStockPurchaseAsk.findMany({
    where: {
      cleanerId: cleaner.id,
      state: { in: ["ASKED", "ACCEPTED"] },
      ...(jobId ? { OR: [{ jobId }, { jobId: null, need: { propertyId: propertyId ?? undefined } }] } : {}),
    },
    include: { need: { select: { itemName: true, unit: true, propertyName: true, propertyId: true, itemId: true } }, shoppingRun: { include: { settlements: { take: 1, orderBy: { createdAt: "desc" } }, lines: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return asks.map((ask) => {
    const line = ask.shoppingRun?.lines.find((row) => row.propertyId === ask.need.propertyId && row.itemId === ask.need.itemId) ?? null;
    const run: AskRunFacts = ask.shoppingRun
      ? { submittedAt: ask.shoppingRun.submittedAt, reimbursementApproved: Boolean(ask.shoppingRun.settlements[0]?.adminApprovedForCleanerReimbursement), line }
      : null;
    return {
      id: ask.id,
      state: purchaseAskState(ask.state, run),
      itemName: ask.need.itemName,
      unit: ask.need.unit,
      quantity: ask.quantity,
      propertyName: ask.need.propertyName,
      jobId: ask.jobId,
      note: ask.note,
      askedByName: ask.askedByName,
      askedAt: ask.createdAt.toISOString(),
      runId: ask.shoppingRunId,
    };
  });
}
