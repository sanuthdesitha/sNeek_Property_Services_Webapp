import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Post confirmed purchases in the same transaction as completion, never suggestions. */
export async function syncShoppingRunHeldStock(tx: Prisma.TransactionClient, runId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${runId} FOR UPDATE`;
  const receiptId = `shopping_stock_${createHash("sha256").update(runId).digest("hex")}`;
  if (await tx.auditLog.findUnique({ where: { id: receiptId } })) return { count: 0, duplicated: true };
  const run = await tx.shoppingRun.findUnique({ where: { id: runId }, include: { lines: true } });
  if (!run) throw new Error("Shopping run not found.");
  if (!run.submittedAt) throw new Error("Complete the shopping run before adding its purchases to stock on hand.");
  // Older manual deposits already posted this run. Do not restore consumed/delivered quantities.
  if (await tx.heldStock.count({ where: { shoppingRunId: runId } })) return { count: 0, duplicated: true };

  const totals = new Map<string, { quantity: number; cost: number; costQuantity: number }>();
  let count = 0;
  for (const line of run.lines) {
    if (line.status !== "PURCHASED" || line.purchasedQty <= 0) continue;
    if (!Number.isFinite(line.purchasedQty)) throw new Error("Purchased quantity is invalid.");
    let itemId = line.itemId;
    if (!itemId) {
      // Custom purchases become reusable catalogue entries instead of disappearing from stock.
      const name = line.itemName.trim(), unit = line.unit.trim() || "unit", category = line.category.trim() || "CUSTOM";
      if (!name) throw new Error("Name the purchased item before completing this run.");
      const signature = JSON.stringify([name.toLowerCase(), unit.toLowerCase(), category.toLowerCase()]);
      itemId = `shopping_item_${createHash("sha256").update(signature).digest("hex")}`;
      await tx.inventoryItem.upsert({ where: { id: itemId }, update: {}, create: { id: itemId, name, unit, category, supplier: line.supplier } });
      await tx.shoppingRunLine.update({ where: { id: line.id }, data: { itemId } });
    }
    const total = totals.get(itemId) ?? { quantity: 0, cost: 0, costQuantity: 0 };
    total.quantity += line.purchasedQty;
    if (line.unitCost != null) { total.cost += line.unitCost * line.purchasedQty; total.costQuantity += line.purchasedQty; }
    totals.set(itemId, total);
    await tx.heldStock.create({ data: { itemId, holderUserId: run.ownerUserId, shoppingRunId: run.id,
      shoppingRunLineId: line.id, quantity: line.purchasedQty, originalQty: line.purchasedQty,
      unitCostAud: line.lineCost != null ? Number((line.lineCost / line.purchasedQty).toFixed(6)) : line.unitCost,
      sourceNote: `Shopping run: ${run.title}` } });
    count++;
  }
  await tx.auditLog.create({ data: { id: receiptId, userId: run.ownerUserId, action: "SHOPPING_PURCHASES_POSTED_TO_HELD_STOCK", entity: "ShoppingRun", entityId: run.id,
    after: { holderUserId: run.ownerUserId, items: Array.from(totals.entries()).map(([itemId, total]) => ({ itemId, quantity: total.quantity })) } } });
  return { count, duplicated: false };
}
