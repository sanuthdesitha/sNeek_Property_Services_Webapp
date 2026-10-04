// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const deduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inventory/stock", () => ({ deductStockFromSubmission: deduct }));
import { deductJobStockOnce } from "@/lib/cleaner/submission-stock";
const input = { jobId: "job", propertyId: "property", submissionId: "correction", usage: { soap: 3 } };
beforeEach(() => vi.resetAllMocks());
it.each(["receipt", "historical"])("retains original deductions on %s-backed resubmission and records review", async mode => {
  const tx = { appSetting: { findUnique: vi.fn().mockResolvedValue(mode === "receipt" ? { key: "key" } : null), upsert: vi.fn() },
    stockTx: { findFirst: vi.fn().mockResolvedValue(mode === "historical" ? { submissionId: "original" } : null) } };
  expect((await deductJobStockOnce(tx as any, input)).stockCorrectionRequired).toBe(true);
  expect(deduct).not.toHaveBeenCalled();
  expect(tx.appSetting.upsert.mock.calls[0][0].create.value).toMatchObject({ status: "PENDING_ADMIN_REVIEW", usage: { soap: 3 } });
});
it("deducts first clean and writes its receipt in the same transaction", async () => {
  const tx = { appSetting: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, stockTx: { findFirst: vi.fn().mockResolvedValue(null) } };
  deduct.mockResolvedValue({ lowStockRows: [] });
  expect((await deductJobStockOnce(tx as any, input)).stockCorrectionRequired).toBe(false);
  expect(deduct).toHaveBeenCalledWith("property", "correction", { soap: 3 }, tx);
  expect(tx.appSetting.create).toHaveBeenCalledTimes(1);
});
