// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
import { deliverHeldStock } from "@/lib/inventory/held-stock";
let state: any; let source: any; let failCharge = false; let clientPaid = false; let events: string[];
const deliver = (quantity = 1, propertyId = "property-a", owner = "cleaner") => deliverHeldStock({ heldStockId: "held", propertyId, quantity, deliveredById: owner, requireHolderUserId: owner });
beforeEach(() => {
  vi.clearAllMocks(); failCharge = false; clientPaid = false; events = [];
  source = { shoppingRunId: "run", propertyId: null, purchasedQty: 3, lineCost: 10, shoppingMinutes: 7 };
  state = { held: { id: "held", holderUserId: "cleaner", itemId: "soap", shoppingRunLineId: "line", quantity: 3, status: "HELD" }, deliveries: [], charges: [], stocks: {}, audit: [] };
  // This in-memory transaction stages changes and commits only on success. It
  // verifies service transaction boundaries, not PostgreSQL rollback/locking.
  m.transaction.mockImplementation(async work => {
    const draft = structuredClone(state);
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray) => { events.push(sql.join("")); return []; },
      heldStock: { findUnique: async () => draft.held, updateMany: async ({ where, data }: any) => { if (draft.held.quantity < where.quantity.gte) return { count: 0 }; draft.held.quantity -= data.quantity.decrement; return { count: 1 }; }, update: async ({ data }: any) => Object.assign(draft.held, data) },
      shoppingRunLine: { findUnique: async () => source },
      heldStockDelivery: { findUnique: async ({ where }: any) => draft.deliveries.find((row: any) => row.id === where.id) ?? null, aggregate: async () => ({ _sum: { quantity: draft.deliveries.reduce((s: number, d: any) => s + d.quantity, 0) } }), create: async ({ data }: any) => { const row = { ...data, id: data.id ?? `delivery-${draft.deliveries.length}` }; draft.deliveries.push(row); return row; } },
      propertyStock: { upsert: async ({ create }: any) => { events.push("property-stock"); draft.stocks[create.propertyId] = (draft.stocks[create.propertyId] ?? 0) + create.onHand; return { id: create.propertyId }; } },
      stockTx: { create: async ({ data }: any) => draft.audit.push(data) },
      shoppingSettlement: { findFirst: async ({ where }: any) => where.OR && clientPaid ? { id: "paid" } : null },
      clientInvoiceLine: { findFirst: async () => null },
      property: { findUnique: async () => ({ clientId: "client-a" }) },
      shoppingClientCharge: { findUnique: async () => null, create: async ({ data }: any) => { if (failCharge) throw new Error("charge failed"); draft.charges.push(data); return data; } },
    };
    const result = await work(tx); state = draft; return result;
  });
});
it("conserves exact expense cents and shopping minutes over partial general deliveries", async () => {
  await deliver(1); await deliver(1, "property-b"); await deliver(1);
  expect(state.charges.map((c: any) => c.expenseAmount)).toEqual([3.33, 3.33, 3.34]);
  expect(state.charges.reduce((sum: number, c: any) => sum + c.shoppingMinutes, 0)).toBe(7);
  expect(state.charges.every((c: any) => c.clientId === "client-a" && c.sourceKey.startsWith("delivery:"))).toBe(true);
  expect(state.held).toMatchObject({ quantity: 0, status: "DELIVERED" });
  expect(state.stocks).toEqual({ "property-a": 2, "property-b": 1 });
});
it("does not charge a property-earmarked purchase a second time", async () => { source.propertyId = "property-a"; await deliver(); expect(state.charges).toEqual([]); expect(state.stocks["property-a"]).toBe(1); });
it("rejects an earmarked purchase sent to another property before any mutation", async () => { source.propertyId = "property-b"; const before = structuredClone(state); await expect(deliver()).rejects.toThrow("another property"); expect(state).toEqual(before); });
it("rejects another owner's holding before changing stock or charges", async () => { const before = structuredClone(state); await expect(deliver(1, "property-a", "other")).rejects.toThrow("not on hand with you"); expect(state).toEqual(before); });
it("does not commit delivery or stock when the real charge helper rejects", async () => { failCharge = true; const before = structuredClone(state); await expect(deliver()).rejects.toThrow("charge failed"); expect(state).toEqual(before); });
it("does not bill client-paid expenses again but preserves shopping minutes", async () => { clientPaid = true; await deliver(3); expect(state.charges[0]).toMatchObject({ expenseAmount: 0, shoppingMinutes: 7 }); });


it("replays an acknowledged full delivery after DELIVERED without another charge or stock increment", async () => {
  const input = { heldStockId: "held", propertyId: "property-a", quantity: 3, deliveredById: "cleaner", requireHolderUserId: "cleaner", requestId: "d067b35f-1cee-4444-8333-02b8c7f71ca1" };
  const first = await deliverHeldStock(input); const after = structuredClone(state);
  expect(state.held.status).toBe("DELIVERED"); expect(await deliverHeldStock(input)).toEqual(first); expect(state).toEqual(after); expect(state.charges).toHaveLength(1);
});
it("rejects changed details under the same request identity without another mutation", async () => {
  const input = { heldStockId: "held", propertyId: "property-a", quantity: 1, deliveredById: "cleaner", requireHolderUserId: "cleaner", requestId: "d067b35f-1cee-4444-8333-02b8c7f71ca1" };
  await deliverHeldStock(input); const after = structuredClone(state);
  await expect(deliverHeldStock({ ...input, quantity: 2 })).rejects.toThrow("different details");
  await expect(deliverHeldStock({ ...input, propertyId: "property-b" })).rejects.toThrow("different details"); expect(state).toEqual(after);
});it("locks source run before property stock mutation for single deliveries too", async () => { await deliver(); const run = events.findIndex(value => value.includes('ShoppingRun')); const stock = events.indexOf("property-stock"); expect(run).toBeGreaterThanOrEqual(0); expect(run).toBeLessThan(stock); expect(events[0]).toContain('HeldStock'); });