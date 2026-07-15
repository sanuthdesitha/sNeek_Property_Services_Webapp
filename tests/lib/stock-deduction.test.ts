import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the module-level dependencies so importing stock.ts is side-effect free
// (no Prisma connection, no logger noise, no notifications). Defined via
// vi.hoisted so the (hoisted) vi.mock factory can reference them.
const { dbUserFindMany, dbNotificationCreateMany } = vi.hoisted(() => ({
  dbUserFindMany: vi.fn().mockResolvedValue([]),
  dbNotificationCreateMany: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: dbUserFindMany },
    notification: { createMany: dbNotificationCreateMany },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/notifications/accountability", () => ({
  notifyRestockRunCreated: vi.fn().mockResolvedValue(undefined),
}));

import { deductStockFromSubmission } from "@/lib/inventory/stock";

/**
 * Build a fake Prisma transaction client that stands in for the `tx` handle the
 * submit route now passes. `after` is the on-hand value reported by the post-
 * decrement read.
 */
function makeTx(stock: any, after: number, updateCount = 1) {
  const stockTxCreate = vi.fn().mockResolvedValue({});
  const tx = {
    propertyStock: {
      // First call (with `include`) returns the full stock row; later reads
      // (with `select`) return the current on-hand.
      findUnique: vi.fn().mockImplementation((args: any) =>
        args?.include ? stock : { onHand: after }
      ),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      update: vi.fn().mockResolvedValue({}),
    },
    stockTx: { create: stockTxCreate },
  };
  return { tx, stockTxCreate };
}

const baseStock = {
  id: "stock-1",
  itemId: "item-1",
  reorderThreshold: 4,
  parLevel: 10,
  item: { name: "Dish soap", category: "CONSUMABLE", supplier: "Acme", unit: "bottle" },
};

describe("deductStockFromSubmission (tx mode)", () => {
  beforeEach(() => {
    dbUserFindMany.mockClear();
    dbNotificationCreateMany.mockClear();
  });

  it("deducts on the passed tx and returns a low-stock row when below threshold", async () => {
    const { tx, stockTxCreate } = makeTx(baseStock, /* after */ 2);

    const { lowStockRows } = await deductStockFromSubmission(
      "prop-1",
      "sub-1",
      { "item-1": 3 },
      tx as any
    );

    // Wrote the ledger entry on the tx, not the base db.
    expect(tx.propertyStock.updateMany).toHaveBeenCalledOnce();
    expect(stockTxCreate).toHaveBeenCalledOnce();
    expect(stockTxCreate.mock.calls[0][0].data.quantity).toBe(-3);

    // 2 <= reorderThreshold(4) → surfaced as low stock.
    expect(lowStockRows).toHaveLength(1);
    expect(lowStockRows[0]).toMatchObject({ itemId: "item-1", itemName: "Dish soap", onHand: 2 });

    // In tx mode the side-effects must NOT fire here (caller fires them post-commit).
    expect(dbUserFindMany).not.toHaveBeenCalled();
    expect(dbNotificationCreateMany).not.toHaveBeenCalled();
  });

  it("returns no low-stock rows when the item stays above threshold", async () => {
    const { tx } = makeTx(baseStock, /* after */ 99);

    const { lowStockRows } = await deductStockFromSubmission(
      "prop-1",
      "sub-1",
      { "item-1": 1 },
      tx as any
    );

    expect(lowStockRows).toHaveLength(0);
    expect(dbUserFindMany).not.toHaveBeenCalled();
  });

  it("drains to zero (never negative) when on hand is short of the requested qty", async () => {
    // updateMany reports count 0 → the conditional full decrement didn't apply,
    // so the code re-reads and drains what remains.
    const { tx, stockTxCreate } = makeTx({ ...baseStock }, /* after */ 0, /* updateCount */ 0);
    // The "current" re-read inside the short-stock branch returns 2 remaining.
    tx.propertyStock.findUnique
      .mockImplementationOnce((args: any) => (args?.include ? baseStock : { onHand: 2 }))
      .mockImplementationOnce(() => ({ onHand: 2 })) // current remaining
      .mockImplementationOnce(() => ({ onHand: 0 })); // after drain

    const { lowStockRows } = await deductStockFromSubmission(
      "prop-1",
      "sub-1",
      { "item-1": 5 },
      tx as any
    );

    // Logged the quantity ACTUALLY removed (2), not the requested 5.
    expect(stockTxCreate.mock.calls[0][0].data.quantity).toBe(-2);
    expect(lowStockRows[0].onHand).toBe(0);
  });
});
