import { describe, expect, it } from "vitest";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { newJobRights } from "@/lib/jobs/new-job/rights";

/** Owner default (pending confirmation): ops managers have the same New job rights on a phone as on desktop. */
describe("New job rights", () => {
  it("administrators may create and repeat", () => {
    expect(newJobRights(null, false)).toEqual({ canCreate: true, canRepeat: true, reason: null });
  });

  it("an operations manager with Jobs manage may create; Repeats follows Calendar", () => {
    const levels = { ...allOpsLevels("manage"), calendar: "read" as const };
    expect(newJobRights(levels, false)).toMatchObject({ canCreate: true, canRepeat: false });
  });

  it("view-only Jobs may look but not create, with a reason", () => {
    const rights = newJobRights(allOpsLevels("read"), false);
    expect(rights.canCreate).toBe(false);
    expect(rights.reason).toMatch(/view only/);
  });

  it("read-only testing as someone else creates nothing", () => {
    expect(newJobRights(null, true)).toMatchObject({ canCreate: false, canRepeat: false });
  });

  it("rights take no device input: the same levels give the same answer on any screen", () => {
    expect(newJobRights.length).toBe(2);
  });

  it("the preview routes belong to Jobs: view may read, never write; the page is a Jobs page", () => {
    for (const path of ["/api/admin/jobs/new-job/options", "/api/admin/jobs/new-job/property", "/api/admin/jobs/new-job/day", "/api/admin/jobs/new-job/duplicate"]) {
      expect(opsRequestFeature(path)).toBe("jobs");
      expect(canUseOpsPath(allOpsLevels("read"), path, "GET")).toBe(true);
      expect(canUseOpsPath(allOpsLevels("read"), path, "POST")).toBe(false);
    }
    expect(opsRequestFeature("/v2/admin/jobs/new")).toBe("jobs");
    expect(canUseOpsPath(allOpsLevels("read"), "/api/admin/jobs", "POST")).toBe(false);
    expect(opsRequestFeature("/api/admin/recurring-jobs")).toBe("calendar");
  });
});
