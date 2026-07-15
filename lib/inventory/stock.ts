import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { NotificationChannel, NotificationStatus, Role, ShoppingRunStatus, StockTxType } from "@prisma/client";
import { notifyRestockRunCreated } from "@/lib/notifications/accountability";

/** A stock row that has fallen to/below its reorder threshold in a submission. */
type LowStockRow = {
  stockId: string;
  itemId: string;
  itemName: string;
  category: string;
  supplier: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
};

/** Deduct inventory used in a form submission. */
export async function deductStockFromSubmission(
  propertyId: string,
  submissionId: string,
  usageMap: Record<string, number> // itemId → quantity used
): Promise<void> {
  // Collected across the loop, then folded into a single auto-ShoppingRun so a
  // multi-item submission produces one run, not one per item.
  const lowStockRows: LowStockRow[] = [];

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

      lowStockRows.push({
        stockId: stock.id,
        itemId: stock.itemId,
        itemName: stock.item.name,
        category: stock.item.category,
        supplier: stock.item.supplier ?? null,
        unit: stock.item.unit,
        onHand: newOnHand,
        parLevel: stock.parLevel,
      });

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

  // Auto-restock: fold every low item into an open shopping run for the
  // property's client (reuse the earliest non-completed run, else create one).
  // Fully guarded — a failure here must never break the submission's stock write.
  if (lowStockRows.length > 0) {
    try {
      await upsertAutoShoppingRun(propertyId, lowStockRows);
    } catch (err) {
      logger.error({ err, propertyId }, "Auto shopping run upsert failed (non-fatal)");
    }
  }
}

/**
 * Find (or create) an open shopping run covering `propertyId`'s client and
 * upsert a line for each low-stock item. Needed qty = max(parLevel − onHand, 1).
 * Existing lines are raised (never lowered); a brand-new run also fires an admin
 * alert. Returns nothing — best-effort, called inside a try/catch.
 */
async function upsertAutoShoppingRun(propertyId: string, lowRows: LowStockRow[]): Promise<void> {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, name: true, clientId: true },
  });
  if (!property) return;

  // The earliest non-completed status is DRAFT — reuse any open run for this
  // client so low items keep accumulating onto one shopping trip.
  const OPEN_STATUSES: ShoppingRunStatus[] = [
    ShoppingRunStatus.DRAFT,
    ShoppingRunStatus.ACTIVE,
  ];
  let run = await db.shoppingRun.findFirst({
    where: { clientId: property.clientId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let createdNew = false;
  if (!run) {
    // ShoppingRun.ownerUserId is required — fall back to a system admin/ops user.
    const owner = await db.user.findFirst({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!owner) return; // no one to own the run — skip gracefully
    run = await db.shoppingRun.create({
      data: {
        ownerUserId: owner.id,
        clientId: property.clientId,
        status: ShoppingRunStatus.DRAFT,
        title: `Auto — low stock at ${property.name}`,
        notes: "Automatically created from low stock detected during a job submission.",
      },
      select: { id: true },
    });
    createdNew = true;
  }

  // Existing lines for this run + property so we upsert (raise) instead of
  // duplicating. Match on itemId when present, else on itemName.
  const existingLines = await db.shoppingRunLine.findMany({
    where: { shoppingRunId: run.id, propertyId },
    select: { id: true, itemId: true, itemName: true, plannedQty: true },
  });

  for (const row of lowRows) {
    const needed = Math.max(row.parLevel - row.onHand, 1);
    const match = existingLines.find((l) =>
      row.itemId ? l.itemId === row.itemId : l.itemName === row.itemName
    );
    if (match) {
      // Raise the planned quantity only if the new need is greater.
      if (needed > match.plannedQty) {
        await db.shoppingRunLine.update({
          where: { id: match.id },
          data: { plannedQty: needed },
        });
      }
    } else {
      await db.shoppingRunLine.create({
        data: {
          shoppingRunId: run.id,
          propertyId,
          itemId: row.itemId,
          itemName: row.itemName,
          category: row.category,
          supplier: row.supplier,
          unit: row.unit,
          plannedQty: needed,
          note: "Auto-added from low stock at submission.",
        },
      });
    }
  }

  // Only alert admins when a brand-new run was created (an extension of an
  // existing run is silent — admins already know about the open run).
  if (createdNew) {
    void notifyRestockRunCreated({
      runId: run.id,
      propertyName: property.name,
      itemCount: lowRows.length,
    }).catch((err) => logger.error({ err }, "notifyRestockRunCreated failed"));
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
