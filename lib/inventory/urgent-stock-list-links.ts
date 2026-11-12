/**
 * Wave F facts shown on an urgent need row and panel: the job it was reported
 * from, the shopping run it is on (and what that run says about the item), and
 * the latest "buy" ask. Read for one page of rows at a time.
 */
import { db } from "@/lib/db";
import { shoppingRunClosedReason } from "./urgent-stock-shopping";
import { purchaseAskState, type PurchaseAskState } from "./urgent-stock-ask-view";

export type NeedSourceJob = { id: string; jobNumber: string | null };

export type NeedShoppingRun = {
  id: string;
  title: string;
  /** False once the run is submitted, settled or otherwise closed. */
  open: boolean;
  ownerName: string;
  /** The run's line for this property and item; null when it was removed from the run. */
  line: { plannedQty: number; purchasedQty: number; purchased: boolean } | null;
};

export type NeedPurchaseAsk = {
  id: string;
  state: PurchaseAskState;
  cleanerName: string;
  askedByName: string;
  askedAt: string;
  respondedAt: string | null;
  responseNote: string | null;
  quantity: number | null;
};

export type NeedLinks = { sourceJob: NeedSourceJob | null; shoppingRun: NeedShoppingRun | null; purchaseAsk: NeedPurchaseAsk | null };

export const EMPTY_NEED_LINKS: NeedLinks = { sourceJob: null, shoppingRun: null, purchaseAsk: null };

export async function needLinksFor(needIds: string[]): Promise<Map<string, NeedLinks>> {
  if (!needIds.length) return new Map();
  const rows = await db.urgentStockNeed.findMany({
    where: { id: { in: needIds } },
    select: {
      id: true, propertyId: true, itemId: true,
      sourceJob: { select: { id: true, jobNumber: true } },
      shoppingRun: { select: { id: true, title: true, status: true, submittedAt: true, owner: { select: { name: true, email: true } }, settlements: true, lines: { select: { propertyId: true, itemId: true, plannedQty: true, purchasedQty: true, status: true } } } },
      purchaseAsks: {
        orderBy: { createdAt: "desc" }, take: 1,
        include: { shoppingRun: { select: { submittedAt: true, settlements: { select: { adminApprovedForCleanerReimbursement: true }, orderBy: { createdAt: "desc" }, take: 1 }, lines: { select: { propertyId: true, itemId: true, purchasedQty: true, status: true } } } } },
      },
    },
  });
  const map = new Map<string, NeedLinks>();
  for (const row of rows) {
    const run = row.shoppingRun;
    const line = run?.lines.find((item) => item.propertyId === row.propertyId && item.itemId === row.itemId) ?? null;
    const ask = row.purchaseAsks[0] ?? null;
    const askLine = ask?.shoppingRun?.lines.find((item) => item.propertyId === row.propertyId && item.itemId === row.itemId) ?? null;
    map.set(row.id, {
      sourceJob: row.sourceJob,
      shoppingRun: run
        ? {
            id: run.id, title: run.title, open: shoppingRunClosedReason(run) === null, ownerName: run.owner.name?.trim() || run.owner.email,
            line: line ? { plannedQty: line.plannedQty, purchasedQty: line.purchasedQty, purchased: line.status === "PURCHASED" || line.purchasedQty > 0 } : null,
          }
        : null,
      purchaseAsk: ask
        ? {
            id: ask.id,
            state: purchaseAskState(ask.state, ask.shoppingRun ? { submittedAt: ask.shoppingRun.submittedAt, reimbursementApproved: Boolean(ask.shoppingRun.settlements[0]?.adminApprovedForCleanerReimbursement), line: askLine } : null),
            cleanerName: ask.cleanerName, askedByName: ask.askedByName, askedAt: ask.createdAt.toISOString(),
            respondedAt: ask.respondedAt?.toISOString() ?? null, responseNote: ask.responseNote, quantity: ask.quantity,
          }
        : null,
    });
  }
  return map;
}
