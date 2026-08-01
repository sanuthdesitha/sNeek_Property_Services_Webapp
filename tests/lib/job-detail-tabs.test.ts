import { describe, it, expect } from "vitest";
import {
  DEFAULT_JOB_DETAIL_TAB,
  JOB_DETAIL_TABS,
  jobDetailTabHref,
  resolveJobDetailTab,
} from "@/lib/jobs/detail-tabs";

describe("resolveJobDetailTab", () => {
  it("accepts every tab the page renders", () => {
    for (const tab of JOB_DETAIL_TABS) {
      expect(resolveJobDetailTab(tab)).toBe(tab);
    }
  });

  it("falls back to the overview when the param is absent", () => {
    expect(resolveJobDetailTab(undefined)).toBe(DEFAULT_JOB_DETAIL_TAB);
    expect(resolveJobDetailTab(null)).toBe(DEFAULT_JOB_DETAIL_TAB);
    expect(resolveJobDetailTab("")).toBe(DEFAULT_JOB_DETAIL_TAB);
  });

  it("falls back rather than rendering an empty page for an unknown tab", () => {
    // A stale bookmark or a renamed tab must still show the job.
    expect(resolveJobDetailTab("billing")).toBe(DEFAULT_JOB_DETAIL_TAB);
    expect(resolveJobDetailTab("Overview")).toBe(DEFAULT_JOB_DETAIL_TAB);
    expect(resolveJobDetailTab("<script>")).toBe(DEFAULT_JOB_DETAIL_TAB);
  });

  it("takes the first entry when the param is repeated", () => {
    // Next.js hands a repeated query param through as an array.
    expect(resolveJobDetailTab(["money", "danger"])).toBe("money");
    expect(resolveJobDetailTab([])).toBe(DEFAULT_JOB_DETAIL_TAB);
  });

  it("ignores non-string values", () => {
    expect(resolveJobDetailTab(42)).toBe(DEFAULT_JOB_DETAIL_TAB);
    expect(resolveJobDetailTab({ tab: "money" })).toBe(DEFAULT_JOB_DETAIL_TAB);
  });
});

describe("jobDetailTabHref", () => {
  it("round-trips through the resolver", () => {
    for (const tab of JOB_DETAIL_TABS) {
      const href = jobDetailTabHref("job_1", tab);
      const param = new URL(href, "https://example.test").searchParams.get("tab");
      expect(resolveJobDetailTab(param)).toBe(tab);
    }
  });

  it("points at the v2 detail page", () => {
    expect(jobDetailTabHref("job_1", "schedule")).toBe("/v2/admin/jobs/job_1?tab=schedule");
  });
});

describe("tab set", () => {
  it("has no duplicates", () => {
    expect(new Set(JOB_DETAIL_TABS).size).toBe(JOB_DETAIL_TABS.length);
  });

  it("still contains every concern the retired manage modal owned", () => {
    // Schedule, people & pay, scope & tasks, billing, laundry, messages and
    // danger each had a section in the modal; skip lives under schedule.
    for (const key of ["schedule", "people", "scope", "money", "laundry", "messages", "danger"]) {
      expect(JOB_DETAIL_TABS).toContain(key as any);
    }
  });
});
