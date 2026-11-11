import { describe, expect, it } from "vitest";
import { hubApiQuery, readHubState, writeHubState } from "@/components/v2/admin/quality/hub/use-hub-state";
import { sharedFiltersOnly } from "@/lib/quality/filters";

const ALL = ["review", "issues", "cleaners", "inspectors", "categories", "coaching"] as const;

describe("Quality hub URL state", () => {
  it("reads the tab, period and filters, and writes them back without losing anything", () => {
    const params = new URLSearchParams("tab=issues&period=custom&from=2026-11-01&to=2026-11-07&cleanerId=c1&openFixes=1&severity=MAJOR&sort=severity&dir=asc&page=2&keep=me");
    const state = readHubState(params, ALL, "cleaners");
    expect(state).toMatchObject({ tab: "issues", sort: "severity", dir: "asc", page: 2 });
    expect(state.period).toMatchObject({ key: "custom", fromKey: "2026-11-01", toKey: "2026-11-07" });
    expect(state.filters).toMatchObject({ cleanerId: "c1", openFixes: true, severity: "MAJOR" });
    const written = writeHubState(params, state);
    expect(Object.fromEntries(written)).toMatchObject({ tab: "issues", period: "custom", from: "2026-11-01", to: "2026-11-07", cleanerId: "c1", openFixes: "1", severity: "MAJOR", page: "2", keep: "me" });
  });

  it("drops unreadable values and keeps a QA inspector on the tabs they may open", () => {
    const state = readHubState(new URLSearchParams("tab=cleaners&period=12d&severity=HUGE&page=-3"), ["issues"], "issues");
    expect(state.tab).toBe("issues");
    expect(state.period.key).toBe("30d");
    expect(state.filters.severity).toBe("");
    expect(state.page).toBe(1);
  });

  it("keys tab reads on the period and shared filters only (issue status filters stay on the Issues tab)", () => {
    const state = readHubState(new URLSearchParams("period=7d&propertyId=p1&severity=MAJOR"), ALL, "cleaners");
    const shared = Object.fromEntries(hubApiQuery({ period: state.period, filters: sharedFiltersOnly(state.filters) }));
    expect(shared).toEqual({ period: "7d", propertyId: "p1" });
    const issues = Object.fromEntries(hubApiQuery({ period: state.period, filters: state.filters }));
    expect(issues).toEqual({ period: "7d", propertyId: "p1", severity: "MAJOR" });
  });
});
