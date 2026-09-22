// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), current: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), catalog: vi.fn(), sync: vi.fn(), head: vi.fn(), query: vi.fn(), billedCharge: vi.fn(), legacySettlement: vi.fn(), resetCharges: vi.fn() }));
const tx = { $queryRaw: m.query, shoppingClientCharge: { findFirst: m.billedCharge, updateMany: m.resetCharges }, shoppingSettlement: { findFirst: m.legacySettlement }, shoppingRun: { findMany: m.find, findUnique: m.current, create: m.create, update: m.update, delete: m.remove } };
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: async () => null }, inventoryItem: { findMany: m.catalog }, shoppingRun: { findMany: m.find }, $transaction: async (work: any) => work(tx) } }));
vi.mock("@/lib/inventory/held-stock", () => ({ syncShoppingRunHeldStock: m.sync }));
vi.mock("@/lib/billing/shopping-client-charges", () => ({ ensureShoppingClientChargesForRun: vi.fn() }));
vi.mock("@/lib/s3", () => ({ resolveS3: async () => ({ bucket: "test", client: { headObject: () => ({ promise: m.head }) } }), publicUrl: (key: string) => `https://safe.invalid/${key}` }));
import { saveShoppingRunForOwner, deleteShoppingRunForOwner, updateShoppingRunByAdmin, type ShoppingRunRow } from "@/lib/inventory/shopping-runs";
const row: ShoppingRunRow = { propertyId: "", propertyName: "General stock", suburb: "", itemId: "soap", itemName: "Caller label", category: "Other", supplier: null, unit: "unit", onHand: 0, parLevel: 0, reorderThreshold: 0, needed: 0, plannedQty: 0, include: true, purchased: true, actualPurchasedQty: 3, actualUnitCost: 4, actualLineCost: 999 };
const input = { name: "Shopping", status: "COMPLETED" as const, ownerScope: "CLEANER" as const, ownerUserId: "cleaner", planningScope: "general", rows: [row], shoppingTime: { requestedMinutes: 30 }, payment: { method: "COMPANY_CARD" as const, paidByScope: "COMPANY" as const, receipts: [{ key: "shopping-receipts/cleaner/receipt.jpg", url: "https://untrusted.invalid/receipt", name: "Receipt" }] } };
let raw: any;
beforeEach(() => {
  vi.resetAllMocks(); m.billedCharge.mockResolvedValue(null); m.legacySettlement.mockResolvedValue(null); raw = { id: "run", ownerUserId: "cleaner", owner: { id: "cleaner", role: "CLEANER", name: "Cleaner" }, title: "Shopping", status: "ACTIVE", legacySource: { ownerScope: "CLEANER" }, lines: [], receipts: [], settlements: [], createdAt: new Date(), updatedAt: new Date(), submittedAt: null };
  m.find.mockResolvedValue([raw]); m.current.mockImplementation(async () => raw);
  m.catalog.mockResolvedValue([{ id: "soap", name: "Hand soap", category: "Cleaning", supplier: "Shop", unit: "bottle", isActive: true }]);
  m.head.mockResolvedValue({ ContentLength: 10, ContentType: "image/jpeg" });
});
it("stores general actual purchases separately from plans and deposits only confirmed completion", async () => {
  await saveShoppingRunForOwner(input);
  const data = m.create.mock.calls[0][0].data;
  expect(data.lines.create[0]).toMatchObject({ propertyId: null, itemId: "soap", itemName: "Hand soap", unit: "bottle", plannedQty: 0, purchasedQty: 3, lineCost: 12 });
  expect(data.receipts.create[0].url).toBe("https://safe.invalid/shopping-receipts/cleaner/receipt.jpg");
  expect(data.submittedAt).toBeInstanceOf(Date); expect(m.sync).toHaveBeenCalledWith(tx, data.id);
});
it("does not submit or deposit a draft with a forged completed timestamp", async () => {
  await saveShoppingRunForOwner({ ...input, status: "DRAFT", completedAt: "2020-01-01T00:00:00Z" });
  expect(m.create.mock.calls[0][0].data.submittedAt).toBeNull(); expect(m.sync).not.toHaveBeenCalled(); expect(m.head).not.toHaveBeenCalled();
});
it("uses server completion time instead of an invalid supplied timestamp", async () => {
  await saveShoppingRunForOwner({ ...input, completedAt: "invalid" });
  expect(m.create.mock.calls[0][0].data.submittedAt).toBeInstanceOf(Date); expect(m.sync).toHaveBeenCalledOnce();
});
it.each(["time", "cost", "receipt", "foreign-receipt", "missing-object"])("rejects completion missing verified %s without writes or stock", async mode => {
  const data = structuredClone(input);
  if (mode === "time") data.shoppingTime.requestedMinutes = 0;
  if (mode === "cost") data.rows[0].actualUnitCost = null, data.rows[0].actualLineCost = null;
  if (mode === "receipt") data.payment.receipts = [];
  if (mode === "foreign-receipt") data.payment.receipts[0].key = "shopping-receipts/other/receipt.jpg";
  if (mode === "missing-object") m.head.mockRejectedValue(new Error("NotFound"));
  await expect(saveShoppingRunForOwner(data)).rejects.toThrow();
  expect(m.create).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled();
});
it("keeps suggested but unpurchased quantities out of actual stock", async () => {
  await saveShoppingRunForOwner({ ...input, status: "IN_PROGRESS", rows: [{ ...row, plannedQty: 4, purchased: false, actualPurchasedQty: 4 }] });
  expect(m.create.mock.calls[0][0].data.lines.create[0]).toMatchObject({ plannedQty: 4, purchasedQty: 0, lineCost: 0 }); expect(m.sync).not.toHaveBeenCalled();
});
it("refuses changes and deletion of submitted purchases", async () => {
  raw.submittedAt = new Date();
  await expect(saveShoppingRunForOwner({ ...input, id: "run" })).rejects.toThrow("locked");
  await expect(deleteShoppingRunForOwner({ id: "run", ownerScope: "CLEANER", ownerUserId: "cleaner" })).rejects.toThrow("cannot be deleted");
  expect(m.update).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
});
it("rechecks settlement stamps after acquiring the write lock", async () => {
  m.current.mockResolvedValue({ ...raw, settlements: [{ includedInPayrollRunId: "payroll" }] });
  await expect(saveShoppingRunForOwner({ ...input, id: "run", status: "IN_PROGRESS" })).rejects.toThrow("changed or was submitted"); expect(m.update).not.toHaveBeenCalled();
});

it("locks admin edits before reading and preserves the latest invoice and payroll stamps", async () => {
  m.query.mockImplementation(async () => { raw.settlements = [{ includedInClientInvoiceId: "invoice-new", includedInPayrollRunId: "payroll-new" }]; return []; });
  await updateShoppingRunByAdmin({ id: "run", reimbursementNote: "Office correction" });
  expect(m.query).toHaveBeenCalledTimes(2);
  expect(m.query.mock.invocationCallOrder[1]).toBeLessThan(m.find.mock.invocationCallOrder[0]);
  expect(m.update.mock.calls[0][0].data.settlements.create[0]).toMatchObject({ includedInClientInvoiceId: "invoice-new", includedInPayrollRunId: "payroll-new" });
});
it.each(["allocated", "legacy"])("blocks payer changes after %s invoicing under the transaction lock", async kind => {
  if (kind === "allocated") m.billedCharge.mockResolvedValue({ id: "charge" }); else m.legacySettlement.mockResolvedValue({ id: "settlement" });
  await expect(updateShoppingRunByAdmin({ id: "run", payment: { method: "CLIENT_CARD", paidByScope: "CLIENT" } })).rejects.toThrow("invoiced client charges");
  expect(m.update).not.toHaveBeenCalled(); expect(m.resetCharges).not.toHaveBeenCalled();
  expect(m.query.mock.invocationCallOrder[1]).toBeLessThan(m.billedCharge.mock.invocationCallOrder[0]);
});
it("invalidates uninvoiced approvals on payer changes while preserving independent pricing", async () => {
  await updateShoppingRunByAdmin({ id: "run", payment: { method: "CLIENT_CARD", paidByScope: "CLIENT" } });
  expect(m.resetCharges).toHaveBeenCalledWith({ where: { shoppingRunId: "run", invoiceId: null, status: "APPROVED" }, data: { status: "DRAFT", treatment: "PENDING", approvedAt: null, approvedById: null, revision: { increment: 1 } } });
  expect(m.update.mock.calls[0][0].data.settlements.create[0]).toMatchObject({ paymentMethod: "CLIENT_CARD", paidByScope: "CLIENT" });
});
it("allows receipt and notes corrections without invalidating already invoiced financials", async () => {
  raw.settlements = [{ paymentMethod: "COMPANY_CARD", paidByScope: "COMPANY", includedInClientInvoiceId: "invoice" }];
  await updateShoppingRunByAdmin({ id: "run", payment: { note: "Correct receipt description", receipts: [] } });
  expect(m.update).toHaveBeenCalledOnce(); expect(m.resetCharges).not.toHaveBeenCalled(); expect(m.billedCharge).not.toHaveBeenCalled();
  expect(m.update.mock.calls[0][0].data.settlements.create[0].includedInClientInvoiceId).toBe("invoice");
});it.each([{ method: "CASH" as const }, { paidByUserId: "different-payer" }])("also requires review when payer details change without scope change: %j", async payment => {
  await updateShoppingRunByAdmin({ id: "run", payment }); expect(m.resetCharges).toHaveBeenCalledOnce();
});
