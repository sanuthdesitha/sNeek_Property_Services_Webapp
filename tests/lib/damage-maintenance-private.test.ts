// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/notifications/sms", () => ({ sendSms: vi.fn() }));
import { createDamageMaintenanceInTransaction } from "@/lib/cases/damage-maintenance-sync";
it.each([false, true])("keeps maintenance visibility equal to the damage case (%s)", async clientVisible => {
  const tx = { propertyMaintenanceItem: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "repair" }) } };
  expect(await createDamageMaintenanceInTransaction(tx as any, {
    caseRow: { id: "case", caseType: "DAMAGE", propertyId: "property", title: "Breakage", clientVisible },
    reportedByUserId: "cleaner", jobId: "job",
  })).toBe("repair");
  expect(tx.propertyMaintenanceItem.create.mock.calls[0][0].data).toMatchObject({ clientVisible, source: clientVisible ? "CLIENT" : "CLEANER" });
});
it("propagates repair persistence failure so the caller can roll back the damage submission", async () => {
  const tx = { propertyMaintenanceItem: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(new Error("repair failed")) } };
  await expect(createDamageMaintenanceInTransaction(tx as any, {
    caseRow: { id: "case", caseType: "DAMAGE", propertyId: "property", title: "Breakage" }, reportedByUserId: "cleaner",
  })).rejects.toThrow("repair failed");
});
