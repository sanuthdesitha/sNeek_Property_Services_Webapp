// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
import { executeHeldStockBatch, heldStockBatchSchema } from "@/lib/inventory/held-stock-batch";
let state: any; let available = true; let unavailableItem = ""; let locks: string[]; let chargesEnabled = false; let failSecondCharge = false;
const requestId = "d067b35f-1cee-4444-8333-02b8c7f71ca1";
const record = { action: "RECORD", requestId, entries: [{ itemId: "soap", quantity: 2 }, { itemId: "towels", quantity: 3 }] };
const delivery = { action: "DELIVER", requestId, propertyId: "property", entries: [{ heldStockId: "held-a", quantity: 2 }, { heldStockId: "held-b", quantity: 3 }] };
beforeEach(() => {
  vi.clearAllMocks(); available = true; unavailableItem = ""; locks = []; chargesEnabled = false; failSecondCharge = false;
  state = { receipts: {}, holdings: { "held-a": { id: "held-a", holderUserId: "cleaner", itemId: "soap", quantity: 2, status: "HELD" }, "held-b": { id: "held-b", holderUserId: "cleaner", itemId: "towels", quantity: 3, status: "HELD" } }, deliveries: {}, stocks: {}, charges: [] };
  // Staged transaction fake: exercises real entry/delivery services, not actual
  // PostgreSQL rollback or lock concurrency.
  m.transaction.mockImplementation(async work => {
    const draft = structuredClone(state);
    const tx = {
      $executeRaw: async (_sql: unknown, id: string) => { locks.push(`advisory:${id}`); },
      $queryRaw: async (sql: TemplateStringsArray, id: string) => { locks.push(`${sql.join("")}:${id}`); return []; },
      property: { findFirst: async () => available ? { id: "property" } : null, findUnique: async () => ({clientId: "client"}) },
      shoppingRunLine: { findUnique: async () => ({shoppingRunId: "run", propertyId: null, purchasedQty: 3, lineCost: 12, shoppingMinutes: 6}) },
      shoppingSettlement: {findFirst: async () => null}, clientInvoiceLine: {findFirst: async () => null},
      shoppingClientCharge: {findUnique: async () => null, create: async ({data}: any) => {if(failSecondCharge && draft.charges.length) throw new Error("Second charge failed"); draft.charges.push(data); return data;}},
      inventoryItem: { findFirst: async ({ where }: any) => where.id === unavailableItem ? null : { id: where.id } },
      auditLog: { findUnique: async ({ where }: any) => draft.receipts[where.id] ?? null, create: async ({ data }: any) => { if (data.id) draft.receipts[data.id] = data; return data; } },
      heldStock: {
        findUnique: async ({ where }: any) => { const row = draft.holdings[where.id]; return row ? {...row, ...(chargesEnabled ? {shoppingRunLineId: "source", shoppingRunLine: {shoppingRunId: "run"}} : {})} : null; },
        create: async ({ data }: any) => { draft.holdings[data.id] = data; return data; },
        updateMany: async ({ where, data }: any) => { const row = draft.holdings[where.id]; if (!row || row.quantity < where.quantity.gte) return { count: 0 }; row.quantity -= data.quantity.decrement; return { count: 1 }; },
        update: async ({ where, data }: any) => Object.assign(draft.holdings[where.id], data),
      },
      heldStockDelivery: { aggregate: async () => ({_sum:{quantity:0}}), findUnique: async ({ where }: any) => draft.deliveries[where.id] ?? null, create: async ({ data }: any) => { draft.deliveries[data.id] = data; return data; } },
      propertyStock: { upsert: async ({ create }: any) => { draft.stocks[create.itemId] = (draft.stocks[create.itemId] ?? 0) + create.onHand; return { id: create.itemId }; } },
      stockTx: { create: async () => ({}) },
    };
    const result = await work(tx); state = draft; return result;
  });
});
it("records all entries with actual helpers in one transaction and replays exact results", async () => {
  const first = await executeHeldStockBatch("cleaner", "admin", true, record); expect(first.results).toHaveLength(2); expect(m.transaction).toHaveBeenCalledOnce();
  const after = structuredClone(state); unavailableItem = "soap";
  expect(await executeHeldStockBatch("cleaner", "admin", true, record)).toEqual(first); expect(state).toEqual(after);
});
it("rolls back earlier record entries when a later catalogue item is unavailable", async () => { unavailableItem = "towels"; const before = structuredClone(state); await expect(executeHeldStockBatch("cleaner", "cleaner", true, record)).rejects.toThrow("no longer available"); expect(state).toEqual(before); });
it("binds batch identity to exact payload and actor", async () => { const a = await executeHeldStockBatch("cleaner", "cleaner", true, record); await expect(executeHeldStockBatch("cleaner", "cleaner", true, { ...record, entries: [{ itemId: "soap", quantity: 3 }] })).rejects.toMatchObject({ status: 409 }); const b = await executeHeldStockBatch("other", "other", true, record); expect(a.batchId).not.toBe(b.batchId); });
it("delivers all holdings once and replays after their quantities reach zero", async () => { const first = await executeHeldStockBatch("cleaner", "cleaner", true, delivery); expect(first.results.every(row => row.deliveryId)).toBe(true); expect(state.stocks).toEqual({ soap: 2, towels: 3 }); const after = structuredClone(state); expect(await executeHeldStockBatch("cleaner", "cleaner", true, delivery)).toEqual(first); expect(state).toEqual(after); });
it("rejects another holder and inaccessible destination with no partial changes", async () => { const before = structuredClone(state); state.holdings["held-b"].holderUserId = "other"; await expect(executeHeldStockBatch("cleaner", "cleaner", true, delivery)).rejects.toMatchObject({ status: 403 }); expect(state.stocks).toEqual({}); state = before; available = false; await expect(executeHeldStockBatch("cleaner", "cleaner", true, delivery)).rejects.toMatchObject({ status: 403 }); expect(state).toEqual(before); });
it("rolls back an earlier delivery when a later holding has insufficient quantity", async () => { state.holdings["held-b"].quantity = 1; const before = structuredClone(state); await expect(executeHeldStockBatch("cleaner", "cleaner", true, delivery)).rejects.toThrow("Not enough"); expect(state).toEqual(before); });
it("locks every holding in stable order before performing individual delivery writes", async () => { await executeHeldStockBatch("cleaner", "cleaner", true, { ...delivery, entries: [...delivery.entries].reverse() }); expect(locks[1]).toContain('HeldStock'); expect(locks[1]).toContain('held-a'); expect(locks[2]).toContain('held-b'); });
it.each([{ ...record, entries: [record.entries[0], record.entries[0]] }, { ...delivery, entries: [delivery.entries[0], delivery.entries[0]] }, { ...record, entries: [] }, { ...record, entries: Array.from({length:51}, (_,i) => ({itemId:String(i),quantity:1})) }, { ...record, entries: [{ itemId: "soap", quantity: Infinity }] }])("rejects malformed or duplicate entries before transaction", async raw => { expect(heldStockBatchSchema.safeParse(raw).success).toBe(false); await expect(executeHeldStockBatch("cleaner", "cleaner", true, raw)).rejects.toThrow(); expect(m.transaction).not.toHaveBeenCalled(); });
it("aborts all stock, deliveries and first billing allocation when the second real charge helper fails", async () => {
  chargesEnabled = true; failSecondCharge = true; const before = structuredClone(state);
  await expect(executeHeldStockBatch("cleaner", "cleaner", true, delivery)).rejects.toThrow("Second charge failed"); expect(state).toEqual(before);
  const firstRunLock = locks.findIndex(value => value.includes('ShoppingRun'));
  expect(firstRunLock).toBeGreaterThan(locks.findIndex(value => value.includes('held-b')));
});