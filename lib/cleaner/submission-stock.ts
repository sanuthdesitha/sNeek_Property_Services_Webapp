import type { Prisma } from "@prisma/client";
import { deductStockFromSubmission } from "@/lib/inventory/stock";
import { toStockTableItems, type StockTableStock } from "@/lib/forms/stock-table";

/**
 * The job property's stock list for the Stock used tables, read on the server
 * at submission (the client's list is never trusted). Same rows and fields
 * as the form read route sends the cleaner: active items, no cost or supplier.
 */
export async function readSubmissionStockTable(tx: Prisma.TransactionClient, input: {
  propertyId: string; inventoryEnabled: boolean;
}): Promise<StockTableStock> {
  if (!input.inventoryEnabled) return { status: "ready", tracked: false, items: [] };
  const rows = await tx.propertyStock.findMany({
    where: { propertyId: input.propertyId, item: { isActive: true } },
    select: {
      onHand: true,
      item: { select: { id: true, name: true, sku: true, category: true, location: true, unit: true } },
    },
    orderBy: [{ item: { location: "asc" } }, { item: { category: "asc" } }, { item: { name: "asc" } }],
  });
  return { status: "ready", tracked: true, items: toStockTableItems(rows) };
}

/** Called with the cleaner action's job lock held. A status reset is a form
 * correction, not a second physical stock use. Corrections are retained for
 * explicit office stock adjustment rather than silently deducted again. */
export async function deductJobStockOnce(tx: Prisma.TransactionClient, input: {
  jobId: string; propertyId: string; submissionId: string; usage: Record<string, number>;
}) {
  const key = `job_submission_stock_v1:${input.jobId}`;
  const [receipt, historicalUsage] = await Promise.all([
    tx.appSetting.findUnique({ where: { key }, select: { key: true } }),
    tx.stockTx.findFirst({ where: { txType: "USED", submission: { jobId: input.jobId } }, select: { submissionId: true } }),
  ]);
  if (receipt || historicalUsage) {
    const reviewKey = `job_stock_correction_review_v1:${input.submissionId}`;
    await tx.appSetting.upsert({ where: { key: reviewKey }, create: { key: reviewKey,
      value: { status: "PENDING_ADMIN_REVIEW", ...input, reason: "Existing clean usage retained. Apply any difference through an explicit stock adjustment." } }, update: {} });
    return { lowStockRows: [], stockCorrectionRequired: true };
  }
  const result = await deductStockFromSubmission(input.propertyId, input.submissionId, input.usage, tx);
  await tx.appSetting.create({ data: { key, value: { submissionId: input.submissionId, usage: input.usage } } });
  return { ...result, stockCorrectionRequired: false };
}
