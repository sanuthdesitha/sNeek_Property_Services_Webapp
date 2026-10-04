import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), reconcile: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/inventory/stock", () => ({ reconcileLowStockShoppingRun: m.reconcile }));
vi.mock("@/lib/notifications/queue-delivery", () => ({ queueDelivery: m.queue }));
import { reconcileSubmissionLowStock, queueLowStockReview } from "@/lib/cleaner/submission-low-stock";
let tx: any;
const input = { jobId: "job", submissionId: "submission", propertyId: "property", lowStockRows: [{ stockId: "stock", itemName: "Soap", onHand: 1 }] } as any;
beforeEach(() => {
 vi.resetAllMocks();
 tx = { $executeRaw: vi.fn(), appSetting: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, user: { findMany: vi.fn().mockResolvedValue([{ id: "admin", role: "ADMIN" }]) } };
 m.transaction.mockImplementation(fn => fn(tx));
 m.reconcile.mockResolvedValue({ runId: "run", createdNew: true });
});
it("commits shopping reconciliation, stable delivery intents and completion receipt together", async () => {
 await reconcileSubmissionLowStock(input);
 expect(m.reconcile).toHaveBeenCalledWith(tx, "property", input.lowStockRows);
 expect(m.queue).toHaveBeenCalledTimes(2);
 expect(m.queue.mock.calls[1][1]).toMatchObject({ tx, eventId: "submission", eventKey: "submission.shopping_run" });
 expect(tx.appSetting.create).toHaveBeenCalled();
});
it("does not recreate shopping or notifications after successful receipt", async () => {
 tx.appSetting.findUnique.mockResolvedValue({ value: { status: "DONE" } });
 await reconcileSubmissionLowStock(input);
 expect(m.reconcile).not.toHaveBeenCalled(); expect(m.queue).not.toHaveBeenCalled();
});
it("does not record completion when intent persistence fails", async () => {
 m.queue.mockRejectedValue(new Error("queue unavailable"));
 await expect(reconcileSubmissionLowStock(input)).rejects.toThrow("queue unavailable");
 expect(tx.appSetting.create).not.toHaveBeenCalled();
});
it("extends an existing run without another new-run email", async () => {
 m.reconcile.mockResolvedValue({ runId: "existing", createdNew: false });
 await reconcileSubmissionLowStock(input);
 expect(m.queue).toHaveBeenCalledTimes(1);
 expect(m.queue.mock.calls[0][1].transports).toEqual(["INBOX", "WEB_PUSH"]);
 expect(tx.appSetting.create.mock.calls[0][0].data.value.shoppingRunId).toBe("existing");
});
it("keeps reconciliation retryable when no active office recipient exists", async () => {
 tx.user.findMany.mockResolvedValue([]);
 await expect(reconcileSubmissionLowStock(input)).rejects.toThrow("LOW_STOCK_NO_OFFICE_RECIPIENT");
 expect(tx.appSetting.create).not.toHaveBeenCalled(); expect(m.queue).not.toHaveBeenCalled();
});
it("queues a stable office-only review notice without externally sending", async () => {
 await queueLowStockReview(input);
 expect(m.queue).toHaveBeenCalledWith(expect.objectContaining({ category: "shopping", jobId: "job" }), expect.objectContaining({ tx, eventId: "submission", eventKey: "submission.low_stock_review", transports: ["INBOX"] }));
 expect(m.reconcile).not.toHaveBeenCalled(); expect(tx.appSetting.create).not.toHaveBeenCalled();
});
