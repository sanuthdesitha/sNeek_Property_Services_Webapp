// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { syncShoppingRunHeldStock } from "@/lib/inventory/shopping-held-stock";
const tx = { $queryRaw: vi.fn(), auditLog: { findUnique: vi.fn(), create: vi.fn() }, shoppingRun: { findUnique: vi.fn() }, heldStock: { count: vi.fn(), create: vi.fn() }, inventoryItem: { upsert: vi.fn() }, shoppingRunLine: { update: vi.fn() } };
const line = { id: "line", itemId: "soap", itemName: "Soap", category: "Cleaning", unit: "bottle", supplier: null, status: "PURCHASED", purchasedQty: 3, unitCost: 4 };
const run = { id: "run", title: "General supplies", ownerUserId: "cleaner", submittedAt: new Date(), lines: [line] };
beforeEach(() => { vi.resetAllMocks(); tx.shoppingRun.findUnique.mockResolvedValue(run); tx.heldStock.count.mockResolvedValue(0); });
it("posts actual purchases to the owner once and preserves source lines for later property allocation", async () => {
  tx.shoppingRun.findUnique.mockResolvedValue({ ...run, lines: [line, { ...line, id: "two", purchasedQty: 2, unitCost: 6 }, { ...line, id: "planned", status: "PLANNED", purchasedQty: 7 }] });
  expect(await syncShoppingRunHeldStock(tx as any, "run")).toEqual({ count: 2, duplicated: false });
  expect(tx.heldStock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ holderUserId: "cleaner", shoppingRunId: "run", shoppingRunLineId: "line", quantity: 3, originalQty: 3, unitCostAud: 4 }) });
  expect(tx.heldStock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shoppingRunLineId: "two", quantity: 2, unitCostAud: 6 }) });
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.auditLog.findUnique.mock.invocationCallOrder[0]);
  expect(tx.auditLog.create).toHaveBeenCalledOnce();
});
it("does not restore stock after replay, even after a delivery", async () => {
  tx.auditLog.findUnique.mockResolvedValue({ id: "receipt" });
  expect((await syncShoppingRunHeldStock(tx as any, "run")).duplicated).toBe(true);
  expect(tx.heldStock.create).not.toHaveBeenCalled(); expect(tx.shoppingRun.findUnique).not.toHaveBeenCalled();
});
it("does not duplicate historical manual deposits", async () => {
  tx.heldStock.count.mockResolvedValue(1);
  expect((await syncShoppingRunHeldStock(tx as any, "run")).duplicated).toBe(true);
  expect(tx.heldStock.create).not.toHaveBeenCalled();
});
it("does not post draft suggestions", async () => {
  tx.shoppingRun.findUnique.mockResolvedValue({ ...run, submittedAt: null });
  await expect(syncShoppingRunHeldStock(tx as any, "run")).rejects.toThrow("Complete the shopping run");
  expect(tx.heldStock.create).not.toHaveBeenCalled();
});
it("links custom actual purchases to reusable catalogue items before adding stock", async () => {
  tx.shoppingRun.findUnique.mockResolvedValue({ ...run, lines: [{ ...line, itemId: null }] });
  await syncShoppingRunHeldStock(tx as any, "run");
  const id = tx.inventoryItem.upsert.mock.calls[0][0].create.id;
  expect(tx.shoppingRunLine.update).toHaveBeenCalledWith({ where: { id: "line" }, data: { itemId: id } });
  expect(tx.heldStock.create.mock.calls[0][0].data.itemId).toBe(id);
});
it("records an empty completion without inventing purchased stock", async () => {
  tx.shoppingRun.findUnique.mockResolvedValue({ ...run, lines: [{ ...line, purchasedQty: 0 }] });
  expect((await syncShoppingRunHeldStock(tx as any, "run")).count).toBe(0);
  expect(tx.heldStock.create).not.toHaveBeenCalled(); expect(tx.auditLog.create).toHaveBeenCalledOnce();
});
it("fails atomically when creating a holding fails", async () => {
  tx.heldStock.create.mockRejectedValue(new Error("storage failed"));
  await expect(syncShoppingRunHeldStock(tx as any, "run")).rejects.toThrow("storage failed");
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
