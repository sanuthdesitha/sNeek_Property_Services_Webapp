// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ run: vi.fn(), delivery: vi.fn(), deliveries: vi.fn(), users: vi.fn(), purchase: vi.fn(), allow: vi.fn(), send: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shoppingRun: { findUnique: m.run }, heldStockDelivery: { findUnique: m.delivery, findMany: m.deliveries }, user: { findMany: m.users }, notification: { update: m.update }, $transaction: (fn: any) => fn({ $executeRaw: vi.fn(), notification: { findUnique: m.find, create: m.create } }) } }));
vi.mock("@/lib/inventory/client-purchases", () => ({ getClientPurchases: m.purchase }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.allow }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.send }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.invalid${path}` }));
import { notifyClientsShoppingCompleted, notifyHeldStockDeliveries } from "@/lib/inventory/client-shopping-notifications";
beforeEach(() => { vi.resetAllMocks(); m.run.mockResolvedValue({ submittedAt: new Date(), lines: [{ property: { clientId: "c" } }] }); m.users.mockResolvedValue([{ id: "u", clientId: "c", email: "test@example.invalid" }]); m.allow.mockResolvedValue(true); m.find.mockResolvedValue(null); m.send.mockResolvedValue({ ok: true }); m.purchase.mockResolvedValue({ runs: [{ date: "2026-09-22T01:00:00.000Z", shopper: "Alex", total: 4, totalComplete: true, receipts: [], billing: [], lines: [{ itemName: "<script>soap", qty: 2, unit: "bottle", property: "House", lineCost: 4 }], shoppingTime: { requestedMinutes: 10, approvalStatus: "PENDING" }, sharedRun: false }] }); });
it("claims once, sends escaped client-scoped summary and records accepted delivery", async () => { expect(await notifyClientsShoppingCompleted("run")).toEqual({ sent: 1, skipped: 0, unconfirmed: 0 }); expect(m.purchase).toHaveBeenCalledWith("c", { runId: "run" }); expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]); expect(m.send.mock.calls[0][0].html).toContain("&lt;script&gt;soap"); expect(m.send.mock.calls[0][0].html).toContain("/v2/client/shopping"); expect(m.update.mock.calls[0][0].data.status).toBe("SENT"); });
it("never retries an uncertain previously claimed attempt", async () => { m.find.mockResolvedValue({ status: "PENDING" }); expect((await notifyClientsShoppingCompleted("run")).unconfirmed).toBe(1); expect(m.send).not.toHaveBeenCalled(); });
it("honours preferences and unfinished runs without sending", async () => { m.allow.mockResolvedValue(false); expect((await notifyClientsShoppingCompleted("run")).skipped).toBe(1); expect(m.send).not.toHaveBeenCalled(); m.run.mockResolvedValue({ submittedAt: null }); expect((await notifyClientsShoppingCompleted("run")).sent).toBe(0); });
it("does not label unknown delivery as sent", async () => { m.send.mockResolvedValue({ ok: false, acceptance: "UNKNOWN" }); expect((await notifyClientsShoppingCompleted("run")).unconfirmed).toBe(1); expect(m.update.mock.calls[0][0].data).toMatchObject({ status: "FAILED", errorMsg: "Delivery acceptance unknown; review before resending." }); });
it("binds a delivery notification to its client and uses distinct stable event claims", async () => { m.delivery.mockResolvedValue({ property: { clientId: "delivery-client" }, heldStock: { shoppingRunLine: { shoppingRunId: "run" } } }); m.users.mockResolvedValue([{ id: "u", clientId: "delivery-client", email: "test@example.invalid" }]); await notifyClientsShoppingCompleted("run", { deliveryId: "d1" }); await notifyClientsShoppingCompleted("run", { deliveryId: "d2" }); expect(m.users.mock.calls[0][0].where.clientId.in).toEqual(["delivery-client"]); expect(m.create.mock.calls[0][0].data.id).not.toBe(m.create.mock.calls[1][0].data.id); expect(m.purchase).toHaveBeenCalledWith("delivery-client", { runId: "run" }); });
it("rejects a delivery from a different run without sending", async () => { m.delivery.mockResolvedValue({ property: { clientId: "c" }, heldStock: { shoppingRunLine: { shoppingRunId: "other" } } }); expect(await notifyClientsShoppingCompleted("run", { deliveryId: "d1" })).toEqual({ sent: 0, skipped: 0, unconfirmed: 0 }); expect(m.users).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled(); });
it("includes scoped date, shopper, total, approved client labour and signed receipt links", async () => { m.purchase.mockResolvedValue({ runs: [{ date: "2026-09-22T01:00:00.000Z", shopper: "Alex <Shopper>", total: 12, totalComplete: true, lines: [], shoppingTime: null, sharedRun: false, receipts: [{ url: "https://s3.invalid/receipt", name: "Store receipt" }], billing: [{ id: "charge", property: "House", status: "APPROVED", expenseAmount: 12, shoppingMinutes: 10, hourlyRate: 30, labourAmount: 5, invoice: null }] }] }); await notifyClientsShoppingCompleted("run"); const html = m.send.mock.calls[0][0].html; expect(html).toContain("Alex &lt;Shopper&gt;"); expect(html).toContain("$12.00"); expect(html).toContain("10 minutes"); expect(html).toContain("$30.00/hour"); expect(html).toContain("https://s3.invalid/receipt"); });
const batchId = `held_batch_${"a".repeat(64)}`;
const batchDelivery = (id: string, clientId = "c", shoppingRunId = "run") => ({ id, heldStockId: `held-${id}`, property: { clientId }, heldStock: { shoppingRunLine: { shoppingRunId } } });
it("groups multiple delivered items into one email per eligible recipient and replay does not send again", async () => {
 const deliveries = [batchDelivery("d1"), batchDelivery("d2")];
 m.deliveries.mockResolvedValue(deliveries);
 m.users.mockResolvedValue([{ id: "u", clientId: "c", email: "first@example.invalid" }, { id: "u2", clientId: "c", email: "second@example.invalid" }]);
 const results = deliveries.map(row => ({ id: row.heldStockId, deliveryId: row.id }));
 expect((await notifyHeldStockDeliveries(batchId, results)).sent).toBe(2);
 expect(m.send).toHaveBeenCalledTimes(2);
 expect(m.purchase).toHaveBeenCalledWith("c", { runId: "run", deliveryIds: ["d1", "d2"] });
 m.find.mockResolvedValue({ status: "PENDING" });
 expect((await notifyHeldStockDeliveries(batchId, results)).unconfirmed).toBe(2);
 expect(m.send).toHaveBeenCalledTimes(2);
});
it("isolates client/run groups and distinct batches use distinct claims", async () => {
 const deliveries = [batchDelivery("d1"), batchDelivery("d2", "other")];
 m.deliveries.mockImplementation(async ({ where }: any) => deliveries.filter(row => where.id.in.includes(row.id)));
 m.users.mockImplementation(async ({ where }: any) => [{ id: where.clientId.in[0], clientId: where.clientId.in[0], email: "client@example.invalid" }]);
 await notifyHeldStockDeliveries(batchId, deliveries.map(row => ({ id: row.heldStockId, deliveryId: row.id })));
 expect(m.send).toHaveBeenCalledTimes(2);
 expect(m.purchase.mock.calls).toEqual([["c", { runId: "run", deliveryIds: ["d1"] }], ["other", { runId: "run", deliveryIds: ["d2"] }]]);
 const firstClaim = m.create.mock.calls[0][0].data.id;
 await notifyHeldStockDeliveries(`held_batch_${"b".repeat(64)}`, [{ id: "held-d1", deliveryId: "d1" }]);
 expect(m.create.mock.calls[2][0].data.id).not.toBe(firstClaim);
});
it("rejects missing deliveries and a mismatched held-stock identity before emailing", async () => {
 m.deliveries.mockResolvedValue([]);
 await expect(notifyHeldStockDeliveries(batchId, [{ id: "held-d1", deliveryId: "d1" }])).rejects.toThrow("scope changed");
 m.deliveries.mockResolvedValue([batchDelivery("d1")]);
 await expect(notifyHeldStockDeliveries(batchId, [{ id: "wrong", deliveryId: "d1" }])).rejects.toThrow("scope changed");
 expect(m.send).not.toHaveBeenCalled();
});
it("a first recipient opting out does not suppress another eligible recipient in the batch", async () => {
 m.deliveries.mockResolvedValue([batchDelivery("d1")]);
 m.users.mockResolvedValue([{ id: "u1", clientId: "c", email: "first@example.invalid" }, { id: "u2", clientId: "c", email: "second@example.invalid" }]);
 m.allow.mockImplementation(async ({ userId }: any) => userId === "u2");
 expect(await notifyHeldStockDeliveries(batchId, [{ id: "held-d1", deliveryId: "d1" }])).toEqual({ sent: 1, skipped: 1, unconfirmed: 0 });
 expect(m.send).toHaveBeenCalledTimes(1); expect(m.send.mock.calls[0][0].to).toBe("second@example.invalid");
});
