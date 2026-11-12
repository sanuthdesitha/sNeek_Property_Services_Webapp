// @vitest-environment node
// Wave B additive export: reportUrgentStockFromSubmission proves scope by the
// submission (the job is SUBMITTED, so the active-job scope no longer holds).
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (run: (tx: unknown) => unknown) => run(m.tx) } }));
vi.mock("@/lib/notifications/intent-store", () => ({ enqueueNotificationIntent: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { reportUrgentStockFromSubmission } from "@/lib/inventory/urgent-stock";

const report = { propertyId: "property", itemId: "tabs", requestId: "6f1c2a4e-9b8d-4c3a-8e7f-1a2b3c4d5e6f", observedCount: 2, purchaseQuantity: null,
  observedAt: "2026-11-11T01:00:00.000Z", note: "Raised by the job form" };

beforeEach(() => {
  m.tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true, role: "CLEANER", extraRoles: [] }), findMany: vi.fn().mockResolvedValue([]) },
    formSubmission: { findUnique: vi.fn().mockResolvedValue({ submittedById: "cleaner", job: { propertyId: "property" } }) },
    appSetting: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    urgentStockNeed: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), create: vi.fn(), update: vi.fn() },
    urgentStockEvent: { create: vi.fn() },
    property: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: "Unit 3" }) },
    inventoryItem: { findUnique: vi.fn().mockResolvedValue({ isActive: true, name: "Tablets", unit: "tablets" }) },
    propertyStock: { findUnique: vi.fn().mockResolvedValue({ id: "ps", onHand: 5, updatedAt: new Date("2026-11-10T00:00:00Z") }), update: vi.fn() },
    stockTx: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
  };
});

it("refuses a submission by someone else or at another property, before writing", async () => {
  m.tx.formSubmission.findUnique.mockResolvedValue({ submittedById: "other", job: { propertyId: "property" } });
  await expect(reportUrgentStockFromSubmission({ cleanerId: "cleaner", submissionId: "sub", report })).rejects.toThrow("FORBIDDEN");
  m.tx.formSubmission.findUnique.mockResolvedValue({ submittedById: "cleaner", job: { propertyId: "elsewhere" } });
  await expect(reportUrgentStockFromSubmission({ cleanerId: "cleaner", submissionId: "sub", report })).rejects.toThrow("FORBIDDEN");
  expect(m.tx.appSetting.upsert).not.toHaveBeenCalled();
});

it("refuses a deactivated cleaner", async () => {
  m.tx.user.findUnique.mockResolvedValue({ isActive: false, role: "CLEANER", extraRoles: [] });
  await expect(reportUrgentStockFromSubmission({ cleanerId: "cleaner", submissionId: "sub", report })).rejects.toThrow("UNAUTHORIZED");
});

it("returns the need already raised for the same request (no second report)", async () => {
  const { createHash } = await import("node:crypto");
  const fingerprint = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  m.tx.appSetting.findUnique.mockResolvedValue({ value: { fingerprint, result: { id: "need-1" } } });
  await expect(reportUrgentStockFromSubmission({ cleanerId: "cleaner", submissionId: "sub", report })).resolves.toEqual({ id: "need-1" });
  expect(m.tx.propertyStock.update).not.toHaveBeenCalled();
});
