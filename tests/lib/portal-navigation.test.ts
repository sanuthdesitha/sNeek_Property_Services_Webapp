import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";
import { resolveNotificationHrefForRole } from "@/lib/notifications/feed";

const notification = { jobId: "job-1", subject: "Job update", body: "Changed" };

describe("role-aware notification links", () => {
  it.each([
    [Role.ADMIN, "/v2/admin/jobs/job-1"],
    [Role.OPS_MANAGER, "/v2/admin/jobs/job-1"],
    [Role.CLIENT, "/v2/client/jobs/job-1"],
    [Role.VA, "/v2/client/jobs/job-1"],
    [Role.CLEANER, "/v2/cleaner/jobs/job-1"],
    [Role.QA_INSPECTOR, "/v2/qa/jobs/job-1"],
    [Role.LAUNDRY, "/v2/laundry"],
    [Role.MAINTENANCE, "/v2/maintenance"],
  ])("routes %s to its portal", (role, href) => {
    expect(resolveNotificationHrefForRole(notification, role)).toBe(href);
  });
  it("preserves an explicit classic preference", () => {
    expect(resolveNotificationHrefForRole(notification, Role.CLEANER, "v1")).toBe("/cleaner/jobs/job-1");
  });
  it.each([Role.VA, Role.QA_INSPECTOR, Role.MAINTENANCE, Role.LAUNDRY, Role.CLIENT, Role.CLEANER])("never falls back to admin for %s", (role) => {
    expect(resolveNotificationHrefForRole({ ...notification, jobId: null }, role)).not.toContain("/admin");
  });
});

describe("stable mobile destinations", () => {
  it("ignores sidebar order and unrelated additions", () => {
    const nav = ["settings", "reports", "approvals", "laundry", "jobs", ""].map((p) => ({ href: `/v2/client${p ? `/${p}` : ""}` }));
    expect(mobileTabs("client", nav).map((x) => x.href)).toEqual([
      "/v2/client", "/v2/client/jobs", "/v2/client/laundry", "/v2/client/approvals", "/v2/client/reports",
    ]);
  });
  it("never introduces a destination absent from authorized navigation", () => {
    const nav = [{ href: "/v2/client" }, { href: "/v2/client/properties" }];
    expect(mobileTabs("client", nav)).toEqual([nav[0]]);
  });
});
