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

    const newOnHand = Math.max(0, stock.onHand - qty);

    await db.propertyStock.update({
      where: { id: stock.id },
      data: { onHand: newOnHand, updatedAt: new Date() },
    });

    await db.stockTx.create({
      data: {
        propertyStockId: stock.id,
        submissionId,
        txType: StockTxType.USED,
        quantity: -qty,
        notes: `Used in submission ${submissionId}`,
      },
    });

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
