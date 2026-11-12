import { describe, expect, it } from "vitest";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";

// The three admin routes added in Wave A belong to the Jobs feature for
// operations managers; as POST routes they need Jobs "manage".
const ROUTES = ["/api/admin/jobs/view-counts", "/api/admin/jobs/bulk-reschedule", "/api/admin/jobs/import"];

describe("Wave A route ownership", () => {
  it.each(ROUTES)("%s is owned by the Jobs feature and fails closed below manage", (path) => {
    expect(opsRequestFeature(path)).toBe("jobs");
    expect(canUseOpsPath({ ...allOpsLevels("off"), jobs: "manage" }, path, "POST")).toBe(true);
    expect(canUseOpsPath({ ...allOpsLevels("manage"), jobs: "view" }, path, "POST")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("manage"), jobs: "off" }, path, "POST")).toBe(false);
  });
});
