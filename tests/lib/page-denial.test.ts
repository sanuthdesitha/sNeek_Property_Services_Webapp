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
    expect(pageDenialDestination("/v2/admin/activity")).toBe("/v2/admin/access-denied?reason=role&from=%2Fv2%2Fadmin%2Factivity");
    expect(pageDenialDestination("/v2/admin/diagnostics?tab=email")).toBe("/v2/admin/access-denied?reason=role&from=%2Fv2%2Fadmin%2Fdiagnostics%3Ftab%3Demail");
  });

  it("uses the general page elsewhere", () => {
    expect(pageDenialDestination("/v2/cleaner/jobs/job-1")).toBe("/unauthorized?from=%2Fv2%2Fcleaner%2Fjobs%2Fjob-1");
    expect(pageDenialDestination("/admin/settings/pay-rates")).toBe("/unauthorized?from=%2Fadmin%2Fsettings%2Fpay-rates");
  });

  it("carries the refused page only as a validated same-origin path (board \"Access denied\")", () => {
    expect(pageDenialDestination("//evil.example/v2/x")).toBe("/unauthorized");
    expect(pageDenialDestination("/v2/admin/jobs\\evil")).toBe("/v2/admin/access-denied?reason=role");
  });

  it("never redirects a denial page to itself", () => {
    expect(pageDenialDestination("/unauthorized")).toBeNull();
    expect(pageDenialDestination("/v2/admin/access-denied?reason=role")).toBeNull();
  });
});
