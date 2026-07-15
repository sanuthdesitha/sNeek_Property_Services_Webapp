import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
  Role,
  ShoppingRunStatus,
  StockTxType,
} from "@prisma/client";
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

/** Anything that can run our stock reads/writes — the shared Prisma client OR an
 *  interactive transaction handle passed in by a caller that owns the tx. */
type StockClient = typeof db | Prisma.TransactionClient;

/**
 * Deduct the on-hand stock for a single item on the given client, log the USED
 * StockTx, and (if the item drops to/below its reorder threshold) return a
 * LowStockRow. This performs ONLY the data writes — no notifications, no
 * shopping-run — so it is safe to run inside a caller-owned transaction. Returns
 * null when there's nothing to deduct or the row still sits above threshold.
 */
async function deductOneItem(
  client: StockClient,
  propertyId: string,
  submissionId: string,
  itemId: string,
  qty: number
): Promise<LowStockRow | null> {
  const stock = await client.propertyStock.findUnique({
    where: { propertyId_itemId: { propertyId, itemId } },
    include: { item: true },
  });
  if (!stock) {
    logger.warn({ propertyId, itemId }, "PropertyStock not found; skipping deduction");
    return null;
  }

  // Atomic decrement + reconciled ledger. Two concurrent submissions must not
  // both read the same onHand and lose an update (last-write-wins). Try the
  // full decrement conditionally; if there isn't enough on hand, fall back to
  // draining to zero. Either way the StockTx logs the quantity ACTUALLY
  // removed so onHand and the ledger stay reconciled.
  const full = await client.propertyStock.updateMany({
    where: { id: stock.id, onHand: { gte: qty } },
    data: { onHand: { decrement: qty } },
  });
  let removed = qty;
  if (full.count !== 1) {
    // Not enough on hand (or a concurrent writer moved it) — re-read and drain
    // whatever remains to zero rather than writing a stale value.
    const current = await client.propertyStock.findUnique({
      where: { id: stock.id },
      select: { onHand: true },
    });
    removed = Math.max(0, current?.onHand ?? 0);
    if (removed > 0) {
      await client.propertyStock.update({
        where: { id: stock.id },
        data: { onHand: 0 },
      });
    }
  }
  if (removed > 0) {
    await client.stockTx.create({
      data: {
        propertyStockId: stock.id,
        submissionId,
        txType: StockTxType.USED,
        quantity: -removed,
        notes: `Used in submission ${submissionId}`,
      },
    });
  }
  const after = await client.propertyStock.findUnique({
    where: { id: stock.id },
    select: { onHand: true },
  });
  const newOnHand = after?.onHand ?? 0;

  if (newOnHand <= stock.reorderThreshold) {
    logger.warn(
      { propertyId, itemId, onHand: newOnHand, threshold: stock.reorderThreshold },
      "Stock below reorder threshold"
    );
    return {
      stockId: stock.id,
      itemId: stock.itemId,
      itemName: stock.item.name,
      category: stock.item.category,
      supplier: stock.item.supplier ?? null,
      unit: stock.item.unit,
      onHand: newOnHand,
      parLevel: stock.parLevel,
    };
  }
  return null;
}

/**
 * Post-deduction side-effects for low-stock rows: alert admins and fold every
 * low item into a single auto ShoppingRun. Deliberately kept OUT of any stock
 * transaction — these are best-effort and their failure must never roll back a
 * committed clean. Fully guarded.
 */
async function fireLowStockSideEffects(
  propertyId: string,
  lowStockRows: LowStockRow[]
): Promise<void> {
  if (lowStockRows.length === 0) return;

  try {
    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length > 0) {
      for (const row of lowStockRows) {
        await db.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            channel: NotificationChannel.PUSH,
            subject: "Low stock alert",
            body: `${row.itemName} is low at this property (${row.onHand} remaining).`,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          })),
        });
      }
    }
  } catch (err) {
    logger.error({ err, propertyId }, "Low-stock admin alert failed (non-fatal)");
  }

  // Auto-restock: fold every low item into an open shopping run for the
  // property's client (reuse the earliest non-completed run, else create one).
  try {
    await upsertAutoShoppingRun(propertyId, lowStockRows);
  } catch (err) {
    logger.error({ err, propertyId }, "Auto shopping run upsert failed (non-fatal)");
  }
}

/**
 * Deduct inventory used in a form submission.
 *
 * When `tx` is provided the caller owns an interactive transaction and we run
 * every stock read/write ON that handle (no inner `$transaction`), so the whole
 * critical section commits or rolls back as one unit with the caller's other
 * writes (form submission, media, status). In that mode we do NOT fire the
 * low-stock notifications / auto-restock here — those are best-effort external
 * side-effects that must not roll back the clean; we return the low-stock rows
 * so the caller can fire `fireLowStockSideEffects` AFTER the tx commits.
 *
 * When `tx` is omitted we keep the original standalone behaviour: each item's
 * decrement + ledger write runs in its own `$transaction`, and the side-effects
 * fire here.
 */
export async function deductStockFromSubmission(
  propertyId: string,
  submissionId: string,
  usageMap: Record<string, number>, // itemId → quantity used
  tx?: Prisma.TransactionClient
): Promise<{ lowStockRows: LowStockRow[] }> {
  const lowStockRows: LowStockRow[] = [];

  for (const [itemId, qty] of Object.entries(usageMap)) {
    if (qty <= 0) continue;
    const low = tx
      ? // Caller-owned tx: run directly on it (outer tx provides atomicity).
        await deductOneItem(tx, propertyId, submissionId, itemId, qty)
      : // Standalone: preserve the original per-item atomic transaction.
        await db.$transaction((inner) =>
          deductOneItem(inner, propertyId, submissionId, itemId, qty)
        );
    if (low) lowStockRows.push(low);
  }

  // In tx mode the caller fires side-effects post-commit; standalone fires now.
  if (!tx) {
    await fireLowStockSideEffects(propertyId, lowStockRows);
  }

  return { lowStockRows };
}

export { fireLowStockSideEffects };

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
