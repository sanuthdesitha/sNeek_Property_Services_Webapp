import { describe, expect, it } from "vitest";
import { JOB_DETAIL_TABS } from "@/lib/jobs/detail-tabs";
import { JOB_PAGE_VIEWS, chatHashRedirect, jobPageViewHref, resolveJobPageTarget } from "@/lib/jobs/job-page/deep-link";

describe("old ?tab= links", () => {
  it("land somewhere for every tab the old page had", () => {
    for (const tab of JOB_DETAIL_TABS) {
      const target = resolveJobPageTarget({ tab });
      expect(JOB_PAGE_VIEWS).toContain(target.view);
    }
  });

  it("scroll to the stage that owns the old tab's content", () => {
    expect(resolveJobPageTarget({ tab: "people" })).toEqual({ view: "timeline", anchor: "s-dispatch", open: null });
    expect(resolveJobPageTarget({ tab: "quality" }).anchor).toBe("s-qa");
    expect(resolveJobPageTarget({ tab: "laundry" }).anchor).toBe("s-laundry");
    expect(resolveJobPageTarget({ tab: "forms" }).anchor).toBe("s-submitted");
    expect(resolveJobPageTarget({ tab: "scope" }).anchor).toBe("s-scope");
    // The holiday-rates return link and billing deep links open the billing editor.
    expect(resolveJobPageTarget({ tab: "money" }).anchor).toBe("billing");
  });

  it("opens Reschedule for schedule links (jobs board 'Manage schedule', peek 'Reschedule')", () => {
    expect(resolveJobPageTarget({ tab: "schedule" })).toEqual({ view: "timeline", anchor: "s-booking", open: "reschedule" });
  });

  it("opens the matching tab for messages and activity, and the menu for danger", () => {
    expect(resolveJobPageTarget({ tab: "messages" })).toEqual({ view: "messages", anchor: "chat", open: null });
    expect(resolveJobPageTarget({ tab: "activity" }).view).toBe("history");
    expect(resolveJobPageTarget({ tab: "danger" })).toEqual({ view: "timeline", anchor: null, open: "menu" });
  });

  it("fall back to the top of the timeline for unknown, missing or repeated values", () => {
    expect(resolveJobPageTarget(undefined)).toEqual({ view: "timeline", anchor: null, open: null });
    expect(resolveJobPageTarget({ tab: "<script>" })).toEqual({ view: "timeline", anchor: null, open: null });
    expect(resolveJobPageTarget({ tab: ["laundry", "money"] }).anchor).toBe("s-laundry");
  });
});

describe("?view=", () => {
  it("wins over an old tab", () => {
    expect(resolveJobPageTarget({ view: "photos", tab: "money" })).toEqual({ view: "photos", anchor: null, open: null });
  });

  it("ignores an unknown view", () => {
    expect(resolveJobPageTarget({ view: "nonsense" }).view).toBe("timeline");
  });

  it("builds hrefs that round-trip", () => {
    for (const view of JOB_PAGE_VIEWS) {
      const url = new URL(jobPageViewHref("job_1", view), "https://example.test");
      expect(resolveJobPageTarget({ view: url.searchParams.get("view") ?? undefined }).view).toBe(view);
    }
    expect(jobPageViewHref("job_1", "timeline")).toBe("/v2/admin/jobs/job_1");
  });
});

describe("#chat", () => {
  it("moves to the Messages tab from any other view", () => {
    expect(chatHashRedirect("job_1", "timeline", "#chat")).toBe("/v2/admin/jobs/job_1?view=messages#chat");
  });

  it("does nothing when already there or for other hashes", () => {
    expect(chatHashRedirect("job_1", "messages", "#chat")).toBeNull();
    expect(chatHashRedirect("job_1", "timeline", "#billing")).toBeNull();
    expect(chatHashRedirect("job_1", "timeline", "")).toBeNull();
  });
});
