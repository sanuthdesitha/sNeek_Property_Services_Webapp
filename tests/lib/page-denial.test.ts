// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pageDenialDestination } from "@/lib/auth/page-denial";

describe("where a refused page sends the person", () => {
  it("keeps API requests throwing so handlers answer 403", () => {
    expect(pageDenialDestination("/api/admin/system/diagnostics")).toBeNull();
    expect(pageDenialDestination("/api/admin/jobs?status=OPEN")).toBeNull();
  });

  it("does not redirect without trusted path metadata", () => {
    expect(pageDenialDestination(null)).toBeNull();
    expect(pageDenialDestination("")).toBeNull();
  });

  it("explains an administrator-only page inside the admin portal", () => {
    expect(pageDenialDestination("/v2/admin/activity")).toBe("/v2/admin/access-denied?reason=role");
    expect(pageDenialDestination("/v2/admin/diagnostics?tab=email")).toBe("/v2/admin/access-denied?reason=role");
  });

  it("uses the general page elsewhere", () => {
    expect(pageDenialDestination("/v2/cleaner/jobs/job-1")).toBe("/unauthorized");
    expect(pageDenialDestination("/admin/settings/pay-rates")).toBe("/unauthorized");
  });

  it("never redirects a denial page to itself", () => {
    expect(pageDenialDestination("/unauthorized")).toBeNull();
    expect(pageDenialDestination("/v2/admin/access-denied?reason=role")).toBeNull();
  });
});
