import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the module-level dependencies so importing stock.ts is side-effect free
// (no Prisma connection, no logger noise, no notifications). Defined via
// vi.hoisted so the (hoisted) vi.mock factory can reference them.
const { dbUserFindMany, dbNotificationCreateMany, dbTransaction, restockNotice } = vi.hoisted(() => ({
  dbTransaction: vi.fn(), restockNotice: vi.fn(),
  dbUserFindMany: vi.fn().mockResolvedValue([]),
  dbNotificationCreateMany: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: dbTransaction,
    user: { findMany: dbUserFindMany },
    notification: { createMany: dbNotificationCreateMany },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/notifications/accountability", () => ({
  notifyRestockRunCreated: restockNotice,
}));

import { deductStockFromSubmission, reconcileLowStockShoppingRun, fireLowStockSideEffects } from "@/lib/inventory/stock";

/**
 * Build a fake Prisma transaction client that stands in for the `tx` handle the
 * submit route now passes. `after` is the on-hand value reported by the post-
 * decrement read.
 */
function makeTx(stock: any, after: number, updateCount = 1) {
  const stockTxCreate = vi.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
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

it("locks stock before reading its balance so shortfall deductions cannot double-count", async () => {
  const { tx } = makeTx(baseStock, 0, 0);
  await deductStockFromSubmission("property", "submission", { "item-1": 5 }, tx as any);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.propertyStock.findUnique.mock.invocationCallOrder[0]);
  expect(tx.$queryRaw.mock.calls[0][0].join("")).toContain("FOR UPDATE");
});
it("skips missing inventory and nonpositive consumption without a false ledger", async () => {
 const { tx, stockTxCreate } = makeTx(null, 0);
 const result = await deductStockFromSubmission("property", "submission", { missing: 2, unused: 0, invalid: -1 }, tx as any);
 expect(result.lowStockRows).toEqual([]); expect(stockTxCreate).not.toHaveBeenCalled();
 expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
});
it("does not log phantom consumption on a zero-balance shortfall", async () => {
 const { tx, stockTxCreate } = makeTx({ ...baseStock, item: { ...baseStock.item, supplier: null } }, 0, 0);
 const result = await deductStockFromSubmission("property", "submission", { soap: 5 }, tx as any);
 expect(tx.propertyStock.update).not.toHaveBeenCalled(); expect(stockTxCreate).not.toHaveBeenCalled();
 expect(result.lowStockRows[0]).toMatchObject({ onHand: 0, supplier: null });
});
it("locks multiple inventory rows in stable item order", async () => {
 const { tx } = makeTx(baseStock, 10);
 await deductStockFromSubmission("property", "submission", { z: 1, a: 1 }, tx as any);
 expect(tx.propertyStock.findUnique.mock.calls.filter(([args]) => args.include).map(([args]) => args.where.propertyId_itemId.itemId)).toEqual(["a", "z"]);
});
function shoppingTx() {
 return { $executeRaw: vi.fn(), property: { findUnique: vi.fn().mockResolvedValue({ id: "property", name: "Home", clientId: "client" }) },
 user: { findFirst: vi.fn().mockResolvedValue({ id: "owner" }) }, shoppingRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run" }) },
 shoppingRunLine: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn() } };
}
const low = { stockId: "stock", itemId: "soap", itemName: "Soap", category: "SUPPLY", supplier: null, unit: "bottle", onHand: 1, parLevel: 5 };
it("creates one shopping run and its line after locking the client", async () => {
 const tx = shoppingTx();
 expect(await reconcileLowStockShoppingRun(tx as any, "property", [low])).toMatchObject({ runId: "run", createdNew: true });
 expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.shoppingRun.findFirst.mock.invocationCallOrder[0]);
 expect(tx.shoppingRunLine.create.mock.calls[0][0].data).toMatchObject({ plannedQty: 4, propertyId: "property", itemId: "soap" });
});
it("raises existing shopping quantities without duplicating or lowering lines", async () => {
 const tx = shoppingTx(); tx.shoppingRun.findFirst.mockResolvedValue({ id: "existing" });
 tx.shoppingRunLine.findMany.mockResolvedValue([{ id: "line", itemId: "soap", plannedQty: 2 }] as any);
 await reconcileLowStockShoppingRun(tx as any, "property", [low]);
 expect(tx.shoppingRunLine.update).toHaveBeenCalledWith({ where: { id: "line" }, data: { plannedQty: 4 } });
 tx.shoppingRunLine.update.mockClear(); tx.shoppingRunLine.findMany.mockResolvedValue([{ id: "line", itemId: "soap", plannedQty: 8 }] as any);
 await reconcileLowStockShoppingRun(tx as any, "property", [low]);
 expect(tx.shoppingRunLine.update).not.toHaveBeenCalled(); expect(tx.shoppingRunLine.create).not.toHaveBeenCalled(); expect(tx.shoppingRun.create).not.toHaveBeenCalled();
});
it("supports legacy name-only shopping items and properties without clients", async () => {
 const tx = shoppingTx(); tx.property.findUnique.mockResolvedValue({ id: "property", name: "Home", clientId: null } as any);
 tx.shoppingRun.findFirst.mockResolvedValue({ id: "existing" });
 tx.shoppingRunLine.findMany.mockResolvedValue([{ id: "line", itemId: null, itemName: "Soap", plannedQty: 0 }] as any);
 await reconcileLowStockShoppingRun(tx as any, "property", [{ ...low, itemId: "", onHand: 8 }]);
 expect(tx.shoppingRunLine.update).toHaveBeenCalledWith({ where: { id: "line" }, data: { plannedQty: 1 } });
 expect(tx.$executeRaw.mock.calls[0]).toContain("low_stock_shopping:unassigned");
});
it("fails before creating an unowned shopping run", async () => {
 const tx = shoppingTx(); tx.user.findFirst.mockResolvedValue(null as any);
 await expect(reconcileLowStockShoppingRun(tx as any, "property", [low])).rejects.toThrow("LOW_STOCK_OWNER_MISSING");
 expect(tx.shoppingRun.create).not.toHaveBeenCalled();
});
it.each([false, true])("retains missing-property errors for retry (disappeared=%s)", async disappeared => {
 const tx = shoppingTx();
 if (disappeared) tx.property.findUnique.mockResolvedValueOnce({ id: "property", name: "Home", clientId: "client" });
 tx.property.findUnique.mockResolvedValue(null as any);
 await expect(reconcileLowStockShoppingRun(tx as any, "property", [low])).rejects.toThrow("LOW_STOCK_PROPERTY_MISSING");
 expect(tx.shoppingRun.create).not.toHaveBeenCalled();
});
it("alerts office and announces a new reconciled shopping run after standalone stock use", async () => {
 const tx = shoppingTx(); dbTransaction.mockImplementation(fn => fn(tx));
 dbUserFindMany.mockResolvedValue([{ id: "admin" }] as any);
 await fireLowStockSideEffects("property", [low]);
 expect(dbNotificationCreateMany.mock.calls.at(-1)?.[0].data[0]).toMatchObject({ userId: "admin", externalId: "mobile-outbox:pending:shopping", subject: "Low stock alert" });
 expect(restockNotice).toHaveBeenCalledWith({ runId: "run", propertyName: "Home", itemCount: 1 });
});
it("still reconciles shopping when legacy low-stock notification persistence fails", async () => {
 dbUserFindMany.mockRejectedValueOnce(new Error("notice unavailable"));
 const tx = shoppingTx(); tx.shoppingRun.findFirst.mockResolvedValue({ id: "existing" }); dbTransaction.mockImplementation(fn => fn(tx));
 restockNotice.mockClear();
 await expect(fireLowStockSideEffects("property", [low])).resolves.toBeUndefined();
 expect(tx.shoppingRunLine.create).toHaveBeenCalled(); expect(restockNotice).not.toHaveBeenCalled();
});
