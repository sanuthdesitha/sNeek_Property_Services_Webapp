/**
 * On-hand stock ledger service.
 *
 * "Held stock" is inventory someone bought/shopped and physically has, but
 * hasn't dropped at a unit yet. The holder (cleaner / client / QA) can deliver
 * portions to one or more properties over time. Each delivery decrements the
 * holding and increments that unit's real PropertyStock.onHand (with a StockTx
 * audit row), so the unit count only ever reflects stock actually delivered.
 */
import { HeldStockStatus, StockTxType } from "@prisma/client";
import { db } from "@/lib/db";

export async function createHeldStock(input: {
  itemId: string;
  holderUserId: string;
  quantity: number;
  unitCostAud?: number | null;
  shoppingRunId?: string | null;
  sourceNote?: string | null;
}) {
  const qty = Math.max(0, Number(input.quantity) || 0);
  if (qty <= 0) throw new Error("Quantity must be greater than zero.");
  return db.heldStock.create({
    data: {
      itemId: input.itemId,
      holderUserId: input.holderUserId,
      quantity: qty,
      originalQty: qty,
      unitCostAud: input.unitCostAud ?? null,
      shoppingRunId: input.shoppingRunId ?? null,
      sourceNote: input.sourceNote ?? null,
    },
  });
}

const HELD_INCLUDE = {
  item: { select: { id: true, name: true, unit: true, category: true } },
  holder: { select: { id: true, name: true, email: true, role: true } },
} as const;

export async function listHeldStock(opts?: {
  holderUserId?: string;
  itemId?: string;
  includeDelivered?: boolean;
}) {
  return db.heldStock.findMany({
    where: {
      holderUserId: opts?.holderUserId,
      itemId: opts?.itemId,
      ...(opts?.includeDelivered ? {} : { status: HeldStockStatus.HELD, quantity: { gt: 0 } }),
    },
    include: HELD_INCLUDE,
    orderBy: [{ createdAt: "desc" }],
  });
}

/** Group current on-hand holdings by holder, for the "who has what" board. */
export async function getOnHandByHolder() {
  const rows = await listHeldStock();
  const byHolder = new Map<
    string,
    { holder: (typeof rows)[number]["holder"]; items: Array<{ heldStockId: string; item: (typeof rows)[number]["item"]; quantity: number }> }
  >();
  for (const row of rows) {
    const key = row.holderUserId;
    if (!byHolder.has(key)) byHolder.set(key, { holder: row.holder, items: [] });
    byHolder.get(key)!.items.push({ heldStockId: row.id, item: row.item, quantity: row.quantity });
  }
  return Array.from(byHolder.values());
}

/**
 * Move a completed shopping run's purchased items into the run owner's on-hand
 * ledger. Quantities are aggregated per catalog item (a run can have the same
 * item across several properties) with a quantity-weighted unit cost. Idempotent
 * per run — refuses if this run was already deposited. Lines without a catalog
 * `itemId` are skipped (the ledger is keyed on InventoryItem).
 */
export async function depositShoppingRunToOnHand(runId: string) {
  const run = await db.shoppingRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      ownerUserId: true,
      lines: {
        where: { itemId: { not: null }, purchasedQty: { gt: 0 } },
        select: { itemId: true, purchasedQty: true, unitCost: true },
      },
    },
  });
  if (!run) throw new Error("Shopping run not found.");

  const already = await db.heldStock.count({ where: { shoppingRunId: runId } });
  if (already > 0) throw new Error("This run's purchases are already on hand.");

  const byItem = new Map<string, { qty: number; costSum: number; costQty: number }>();
  for (const line of run.lines) {
    if (!line.itemId) continue;
    const agg = byItem.get(line.itemId) ?? { qty: 0, costSum: 0, costQty: 0 };
    agg.qty += line.purchasedQty;
    if (line.unitCost != null) {
      agg.costSum += line.unitCost * line.purchasedQty;
      agg.costQty += line.purchasedQty;
    }
    byItem.set(line.itemId, agg);
  }
  if (byItem.size === 0) throw new Error("No purchased items linked to the catalog to deposit.");

  const created = await db.$transaction(
    Array.from(byItem.entries()).map(([itemId, agg]) =>
      db.heldStock.create({
        data: {
          itemId,
          holderUserId: run.ownerUserId,
          quantity: agg.qty,
          originalQty: agg.qty,
          unitCostAud: agg.costQty > 0 ? Number((agg.costSum / agg.costQty).toFixed(2)) : null,
          shoppingRunId: runId,
          sourceNote: "From shopping run",
        },
      })
    )
  );
  return { count: created.length };
}

/**
 * Drop a quantity of held stock at a unit: decrements the holding and bumps the
 * property's real on-hand count (with an audited StockTx). When the holding hits
 * zero it's marked DELIVERED. All-or-nothing in a transaction.
 */
export async function deliverHeldStock(input: {
  heldStockId: string;
  propertyId: string;
  quantity: number;
  deliveredById: string;
  note?: string | null;
  /** When set, the holding must belong to this user (cleaner self-service guard). */
  requireHolderUserId?: string;
}) {
  const qty = Math.max(0, Number(input.quantity) || 0);
  if (qty <= 0) throw new Error("Delivery quantity must be greater than zero.");

  return db.$transaction(async (tx) => {
    const held = await tx.heldStock.findUnique({ where: { id: input.heldStockId } });
    if (!held) throw new Error("Held stock not found.");
    if (input.requireHolderUserId && held.holderUserId !== input.requireHolderUserId) {
      throw new Error("This stock is not on hand with you.");
    }
    if (held.status !== HeldStockStatus.HELD) throw new Error("This stock has already been cleared.");
    if (held.quantity < qty) throw new Error("Not enough on-hand quantity to deliver.");

    const stock = await tx.propertyStock.upsert({
      where: { propertyId_itemId: { propertyId: input.propertyId, itemId: held.itemId } },
      create: { propertyId: input.propertyId, itemId: held.itemId, onHand: qty },
      update: { onHand: { increment: qty } },
    });

    await tx.stockTx.create({
      data: {
        propertyStockId: stock.id,
        txType: StockTxType.RESTOCKED,
        quantity: qty,
        notes: `Delivered from on-hand stock${input.note ? ` — ${input.note}` : ""}`,
      },
    });

    const remaining = Number((held.quantity - qty).toFixed(4));
    await tx.heldStock.update({
      where: { id: held.id },
      data: { quantity: remaining, status: remaining <= 0 ? HeldStockStatus.DELIVERED : held.status },
    });

    return tx.heldStockDelivery.create({
      data: {
        heldStockId: held.id,
        propertyId: input.propertyId,
        quantity: qty,
        deliveredById: input.deliveredById,
        note: input.note ?? null,
      },
    });
  });
}
