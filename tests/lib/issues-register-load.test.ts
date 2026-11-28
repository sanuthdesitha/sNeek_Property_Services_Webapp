// @vitest-environment node
/** One source that cannot be read is "failed" (not zero) and the others are still listed. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "UTC", accountability: { issueCategories: [] } }) }));
vi.mock("@/lib/db", () => {
  const empty = { findMany: async () => [] };
  return {
  db: {
    qaIssue: { findMany: async () => { throw new Error("connection reset"); } },
    issueTicket: empty,
    damageReport: empty,
    propertyMaintenanceItem: empty,
    urgentStockNeed: empty,
    auditLog: empty,
    user: empty,
    jobAssignment: empty,
    job: empty,
  },
  };
});

import { readRegister } from "@/lib/quality/register/load";
import { REGISTER_SOURCES } from "@/lib/quality/register/model";
import { rangeFromKeys } from "@/lib/quality/period";

describe("readRegister", () => {
  it("marks only the failing source and keeps reading the rest", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await readRegister({ range: rangeFromKeys("2026-11-01", "2026-11-30"), propertyId: null, allowed: new Set(REGISTER_SOURCES) });
    expect(result.sources.find((state) => state.source === "QA_INSPECTION")).toEqual({ source: "QA_INSPECTION", state: "failed", read: null, truncated: false });
    expect(result.sources.filter((state) => state.state === "ok").map((state) => state.source).sort()).toEqual(REGISTER_SOURCES.filter((source) => source !== "QA_INSPECTION").sort());
    expect(spy).toHaveBeenCalled();
  });
});
