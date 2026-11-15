import "server-only";
/**
 * Data for the shopping run page (board "Shopping run", 2026-11-17): the run
 * (getShoppingRunBillingContextById), its item lines with each line's cost as
 * recorded ("Not entered" when missing, never $0.00), the cost coverage, the
 * reimbursement approval from the audit row, and a history built from the
 * run's own dates. Display only: no amount is computed beyond the run
 * service's own line rule (lib/inventory/shopping-line-cost.ts).
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getShoppingRunBillingContextById, type ShoppingRunAdminView } from "./shopping-runs";
import { shoppingCostCoverage, shoppingLineCost, type ShoppingCostCoverage, type ShoppingLineCost } from "./shopping-line-cost";

export type ShoppingRunLineView = {
  key: string;
  propertyId: string;
  propertyName: string;
  clientName: string | null;
  itemName: string;
  unit: string;
  supplier: string | null;
  note: string | null;
  plannedQty: number;
  include: boolean;
  purchased: boolean;
  boughtQty: number;
  cost: ShoppingLineCost;
};

export type ShoppingRunHistoryEntry = { id: string; at: string; label: string };

export type ShoppingReimbursementApprovalView = {
  at: string;
  by: string | null;
  amount: number | null;
  receiptOverrideNote: string | null;
};

export type ShoppingRunPageData = {
  run: ShoppingRunAdminView;
  lines: ShoppingRunLineView[];
  coverage: ShoppingCostCoverage;
  approval: ShoppingReimbursementApprovalView | null;
  history: ShoppingRunHistoryEntry[];
  /** Its purchases are already in stock on hand (the posting receipt exists, or an older manual deposit). */
  stockPosted: boolean;
  timezone: string;
};

function clientByProperty(run: ShoppingRunAdminView): Map<string, string> {
  const map = new Map<string, string>();
  for (const allocation of run.clientAllocations) {
    for (const propertyId of allocation.propertyIds) map.set(propertyId, allocation.clientName);
  }
  return map;
}

/** The history the board draws: the run's own stored dates, newest first. */
export function shoppingRunHistory(run: Pick<ShoppingRunAdminView, "dates" | "ownerName" | "payment">, approval: ShoppingReimbursementApprovalView | null): ShoppingRunHistoryEntry[] {
  const owner = run.ownerName || "the owner";
  const receipts = run.payment.receipts.length;
  const entries: ShoppingRunHistoryEntry[] = [{ id: "created", at: run.dates.createdAt, label: "Created" }];
  if (run.dates.startedAt) entries.push({ id: "started", at: run.dates.startedAt, label: `Started by ${owner}` });
  if (run.dates.submittedAt) {
    entries.push({ id: "submitted", at: run.dates.submittedAt, label: `Submitted by ${owner}${receipts ? ` with ${receipts} receipt${receipts === 1 ? "" : "s"} now on the run` : ""}` });
  }
  if (approval) {
    entries.push({ id: "reimbursement-approved", at: approval.at, label: `Reimbursement approved${approval.by ? ` by ${approval.by}` : ""}${approval.receiptOverrideNote ? `, without a receipt: ${approval.receiptOverrideNote}` : ""}` });
  } else if (run.dates.approvedAt) {
    entries.push({ id: "approved", at: run.dates.approvedAt, label: "Approved" });
  }
  if (run.dates.closedAt) entries.push({ id: "closed", at: run.dates.closedAt, label: "Closed" });
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

async function readApproval(runId: string): Promise<ShoppingReimbursementApprovalView | null> {
  const row = await db.auditLog.findFirst({
    where: { entity: "ShoppingRun", entityId: runId, action: "SHOPPING_REIMBURSEMENT_APPROVED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, after: true, user: { select: { name: true, email: true } } },
  });
  if (!row) return null;
  const after = (row.after ?? {}) as { amount?: unknown; receiptOverrideNote?: unknown };
  return {
    at: row.createdAt.toISOString(),
    by: row.user?.name || row.user?.email || null,
    amount: typeof after.amount === "number" && Number.isFinite(after.amount) ? after.amount : null,
    receiptOverrideNote: typeof after.receiptOverrideNote === "string" && after.receiptOverrideNote ? after.receiptOverrideNote : null,
  };
}

/** The same receipt id lib/inventory/shopping-held-stock.ts writes when it posts a run. */
async function readStockPosted(runId: string): Promise<boolean> {
  const receiptId = `shopping_stock_${createHash("sha256").update(runId).digest("hex")}`;
  const [receipt, held] = await Promise.all([
    db.auditLog.findUnique({ where: { id: receiptId }, select: { id: true } }),
    db.heldStock.count({ where: { shoppingRunId: runId } }),
  ]);
  return Boolean(receipt) || held > 0;
}

export async function loadShoppingRunPage(id: string): Promise<ShoppingRunPageData | null> {
  const run = await getShoppingRunBillingContextById(id);
  if (!run) return null;
  const clients = clientByProperty(run);
  const lines: ShoppingRunLineView[] = run.rows.map((row, index) => ({
    key: `${row.propertyId}:${row.itemId}:${index}`,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    clientName: clients.get(row.propertyId) ?? null,
    itemName: row.itemName,
    unit: row.unit,
    supplier: row.supplier,
    note: row.note ?? null,
    plannedQty: row.plannedQty,
    include: row.include,
    purchased: row.purchased,
    boughtQty: row.actualPurchasedQty,
    cost: shoppingLineCost(row),
  }));
  const [approval, settings, stockPosted] = await Promise.all([readApproval(id), getAppSettings().catch(() => null), readStockPosted(id)]);
  return {
    run,
    lines,
    coverage: shoppingCostCoverage(run.rows),
    approval,
    history: shoppingRunHistory(run, approval),
    stockPosted,
    timezone: settings?.timezone || "Australia/Sydney",
  };
}
