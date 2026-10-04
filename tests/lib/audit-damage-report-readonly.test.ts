// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verification: vi.fn(), create: vi.fn(), vm: vi.fn(), row: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reportVerification: { findUnique: m.verification, create: m.create }, damageReport: { findUnique: m.row } } }));
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/damage/investigation", () => ({ getDamageInvestigationForAdmin: m.vm, listDamageReportPhotoKeys: async () => [], toInvestigationViewModel: () => ({ items: [], propertyName: "Property", reportedByName: "Cleaner", submittedAt: null }) }));
import { buildDamageReportHtml } from "@/lib/reports/damage-report";
beforeEach(() => { vi.resetAllMocks(); m.vm.mockResolvedValue({ items: [], propertyName: "Property", reportedByName: "Cleaner", submittedAt: null }); m.row.mockResolvedValue({}); });
it.each(["ADMIN", "CLIENT"] as const)("renders %s without creating a verification record on GET", async audience => {
  const result = await buildDamageReportHtml("report", audience);
  expect(result?.reference).toBe(""); expect(result?.html).not.toContain("Verify this report"); expect(m.create).not.toHaveBeenCalled();
});
it("preserves an existing verification reference without replacing it", async () => {
  m.verification.mockResolvedValue({ code: "ABCDEFGH" });
  const result = await buildDamageReportHtml("report", "ADMIN");
  expect(result?.html).toContain("Verify this report"); expect(result?.reference).not.toBe(""); expect(m.create).not.toHaveBeenCalled();
});
