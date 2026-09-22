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
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { syncShoppingRunHeldStock } from "./shopping-held-stock";
import { createShoppingClientChargeForDelivery } from "@/lib/billing/shopping-client-charges";
import { deliveryShare } from "./delivery-allocation";
export { syncShoppingRunHeldStock } from "./shopping-held-stock";

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
  includeEmpty?: boolean;
}) {
  return db.heldStock.findMany({
    where: {
      holderUserId: opts?.holderUserId,
      itemId: opts?.itemId,
      ...(opts?.includeDelivered ? {} : { status: HeldStockStatus.HELD, ...(opts?.includeEmpty ? {} : { quantity: { gt: 0 } }) }),
    },
    include: HELD_INCLUDE,
    orderBy: [{ createdAt: "desc" }],
  });
}

/** Group current on-hand holdings by holder, for the "who has what" board. */
export async function getOnHandByHolder(opts?: { includeEmpty?: boolean }) {
  const rows = await listHeldStock(opts);
  const byHolder = new Map<
    string,
    { holder: (typeof rows)[number]["holder"]; items: Array<{ heldStockId: string; item: (typeof rows)[number]["item"]; quantity: number; updatedAt: string; sourceNote: string | null }> }
  >();
  for (const row of rows) {
    const key = row.holderUserId;
    if (!byHolder.has(key)) byHolder.set(key, { holder: row.holder, items: [] });
    byHolder.get(key)!.items.push({ heldStockId: row.id, item: row.item, quantity: row.quantity, updatedAt: row.updatedAt.toISOString(), sourceNote: row.sourceNote });
  }
  return Array.from(byHolder.values());
}

/** Post a completed run once; the same helper is called by automatic completion. */
export async function depositShoppingRunToOnHand(runId: string) {
  return db.$transaction(tx => syncShoppingRunHeldStock(tx, runId));
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
  requestId?: string;
  /** When set, the holding must belong to this user (cleaner self-service guard). */
  requireHolderUserId?: string;
}, database?: import("@prisma/client").Prisma.TransactionClient) {
  const qty = Math.max(0, Number(input.quantity) || 0);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Delivery quantity must be greater than zero.");

  const work = async (tx: import("@prisma/client").Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "HeldStock" WHERE "id" = ${input.heldStockId} FOR UPDATE`;
    const held = await tx.heldStock.findUnique({ where: { id: input.heldStockId } });
    if (!held) throw new Error("Held stock not found.");
    if (input.requireHolderUserId && held.holderUserId !== input.requireHolderUserId) {
      throw new Error("This stock is not on hand with you.");
    }
    const deliveryId = input.requestId ? `delivery_${createHash("sha256").update(JSON.stringify([input.deliveredById, held.id, input.requestId])).digest("hex")}` : undefined;
    if (deliveryId) {
      const previous = await tx.heldStockDelivery.findUnique({ where: { id: deliveryId } });
      if (previous) {
        if (previous.propertyId !== input.propertyId || previous.quantity !== qty || (previous.note ?? null) !== (input.note ?? null)) throw new Error("This delivery request already recorded different details. Refresh stock before a new delivery.");
        return previous;
      }
    }
    if (held.status !== HeldStockStatus.HELD) throw new Error("This stock has already been cleared.");
    const source = held.shoppingRunLineId ? await tx.shoppingRunLine.findUnique({ where: { id: held.shoppingRunLineId } }) : null;
    if (source?.propertyId && source.propertyId !== input.propertyId) throw new Error("This purchase was allocated to another property. Ask the office to review its client charge before changing the destination.");
    if (source) await tx.$queryRaw`SELECT "id" FROM "ShoppingRun" WHERE "id" = ${source.shoppingRunId} FOR UPDATE`;
    const previousDeliveries = source && !source.propertyId ? await tx.heldStockDelivery.aggregate({ where: { heldStockId: held.id }, _sum: { quantity: true } }) : null;

    // Atomic conditional decrement: the WHERE guards on status + sufficient
    // quantity, so two concurrent deliveries can't both pass a stale read-check
    // and over-deliver / drive the holding negative. Only the caller whose
    // update actually matched (count === 1) proceeds; the loser is rejected.
    const claimed = await tx.heldStock.updateMany({
      where: { id: held.id, status: HeldStockStatus.HELD, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
    if (claimed.count !== 1) {
      throw new Error("Not enough on-hand quantity to deliver.");
    }
    // Re-read the post-decrement quantity to flip status when it hits zero.
    const afterDecrement = await tx.heldStock.findUnique({
      where: { id: held.id },
      select: { quantity: true },
    });
    if ((afterDecrement?.quantity ?? 0) <= 0) {
      await tx.heldStock.update({
        where: { id: held.id },
        data: { status: HeldStockStatus.DELIVERED },
      });
    }

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

    const delivery = await tx.heldStockDelivery.create({
      data: {
        ...(deliveryId ? { id: deliveryId } : {}),
        heldStockId: held.id,
        propertyId: input.propertyId,
        quantity: qty,
        deliveredById: input.deliveredById,
        note: input.note ?? null,
      },
    });
    if (source && !source.propertyId) {
      const deliveredBefore = previousDeliveries?._sum.quantity ?? 0;
      await createShoppingClientChargeForDelivery(tx, { deliveryId: delivery.id, runId: source.shoppingRunId, propertyId: input.propertyId,
        expenseAmount: deliveryShare(Math.round((source.lineCost ?? source.purchasedQty * (source.unitCost ?? 0)) * 100), source.purchasedQty, deliveredBefore, qty) / 100,
        shoppingMinutes: deliveryShare(source.shoppingMinutes, source.purchasedQty, deliveredBefore, qty) });
    }
    return delivery;
  };
  return database ? work(database) : db.$transaction(work);
}
