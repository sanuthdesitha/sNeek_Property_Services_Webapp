import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { NotificationChannel, NotificationStatus, Role, StockTxType } from "@prisma/client";

/** Deduct inventory used in a form submission. */
export async function deductStockFromSubmission(
  propertyId: string,
  submissionId: string,
  usageMap: Record<string, number> // itemId → quantity used
): Promise<void> {
  for (const [itemId, qty] of Object.entries(usageMap)) {
    if (qty <= 0) continue;

    const stock = await db.propertyStock.findUnique({
      where: { propertyId_itemId: { propertyId, itemId } },
      include: { item: true },
    });

    if (!stock) {
      logger.warn({ propertyId, itemId }, "PropertyStock not found; skipping deduction");
      continue;
    }

    // Atomic decrement + reconciled ledger. Two concurrent submissions must not
    // both read the same onHand and lose an update (last-write-wins). Try the
    // full decrement conditionally; if there isn't enough on hand, fall back to
    // draining to zero. Either way the StockTx logs the quantity ACTUALLY
    // removed so onHand and the ledger stay reconciled.
    const { newOnHand, removed } = await db.$transaction(async (tx) => {
      const full = await tx.propertyStock.updateMany({
        where: { id: stock.id, onHand: { gte: qty } },
        data: { onHand: { decrement: qty } },
      });
      let removed = qty;
      if (full.count !== 1) {
        // Not enough on hand (or a concurrent writer moved it) — re-read and
        // drain whatever remains to zero rather than writing a stale value.
        const current = await tx.propertyStock.findUnique({
          where: { id: stock.id },
          select: { onHand: true },
        });
        removed = Math.max(0, current?.onHand ?? 0);
        if (removed > 0) {
          await tx.propertyStock.update({
            where: { id: stock.id },
            data: { onHand: 0 },
          });
        }
      }
      if (removed > 0) {
        await tx.stockTx.create({
          data: {
            propertyStockId: stock.id,
            submissionId,
            txType: StockTxType.USED,
            quantity: -removed,
            notes: `Used in submission ${submissionId}`,
          },
        });
      }
      const after = await tx.propertyStock.findUnique({
        where: { id: stock.id },
        select: { onHand: true },
      });
      return { newOnHand: after?.onHand ?? 0, removed };
    });
    void removed;

    // Alert if below reorder threshold
    if (newOnHand <= stock.reorderThreshold) {
      logger.warn(
        { propertyId, itemId, onHand: newOnHand, threshold: stock.reorderThreshold },
        "Stock below reorder threshold"
      );

      const admins = await db.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true },
      });
      if (admins.length > 0) {
        await db.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            channel: NotificationChannel.PUSH,
            subject: "Low stock alert",
            body: `${stock.item.name} is low at this property (${newOnHand} remaining, threshold ${stock.reorderThreshold}).`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
      }
    }
  }
}

/** Apply a manual restock: bump on-hand for each line and log a RESTOCKED tx.
 *  Used by cleaners recording supplies they've topped up (in or out of a job). */
export async function applyRestock(
  lines: Array<{ propertyStockId: string; addQty: number }>,
  byLabel?: string
): Promise<Array<{ propertyStockId: string; onHand: number }>> {
  const results: Array<{ propertyStockId: string; onHand: number }> = [];
  for (const { propertyStockId, addQty } of lines) {
    if (!(addQty > 0)) continue;
    const stock = await db.propertyStock.findUnique({ where: { id: propertyStockId } });
    if (!stock) continue;
    // Atomic increment (no prior-read dependency) so two concurrent restocks of
    // the same row can't lose one of the additions.
    const updated = await db.propertyStock.update({
      where: { id: stock.id },
      data: { onHand: { increment: addQty }, updatedAt: new Date() },
      select: { onHand: true },
    });
    await db.stockTx.create({
      data: {
        propertyStockId: stock.id,
        txType: StockTxType.RESTOCKED,
        quantity: addQty,
        notes: byLabel ? `Restocked by ${byLabel}` : "Restocked",
      },
    });
    results.push({ propertyStockId, onHand: updated.onHand });
  }
  return results;
}

/** Build the combined shopping list across all (or one) property. */
export async function getShoppingList(propertyId?: string) {
  const stocks = await db.propertyStock.findMany({
    where: {
      ...(propertyId ? { propertyId } : {}),
      onHand: { lte: db.propertyStock.fields.reorderThreshold },
    },
    include: {
      item: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  });

  // Group by category / supplier
  const grouped: Record<string, typeof stocks> = {};
  for (const s of stocks) {
    const key = `${s.item.category}||${s.item.supplier ?? "Unknown"}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  return grouped;
}
