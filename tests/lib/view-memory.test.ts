import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { initializeViewMemory, rememberChosenView, rememberedHref, rememberCurrentView, settleChosenView, viewMemoryKey, VIEW_MEMORY_PREFIX } from "@/lib/navigation/view-memory";
let scope = 0;
beforeEach(() => { document.body.dataset.viewScope = `test-${++scope}`; sessionStorage.clear(); history.replaceState({ preserved: 1 }, "", "/v2/admin/jobs"); });
afterEach(() => vi.restoreAllMocks());
it("returns bare navigation to the last view and respects explicit deep links", () => {
  history.replaceState({}, "", "/v2/admin/jobs?view=board&statusChip=COMPLETED&page=3&secret=not-stored");
  rememberCurrentView();
  expect(rememberedHref("/v2/admin/jobs")).toBe("/v2/admin/jobs?view=board&statusChip=COMPLETED&page=3");
  expect(rememberedHref("/v2/admin/jobs?view=list")).toBe("/v2/admin/jobs?view=list");
  expect(rememberedHref("https://other.invalid/v2/admin/jobs")).toBe("https://other.invalid/v2/admin/jobs");
});
it("keeps identity, record and retained account transport separate", () => {
  history.replaceState({}, "", "/v2/admin/jobs/one?tab=money"); rememberCurrentView();
  expect(rememberedHref("/v2/admin/jobs/two")).toBe("/v2/admin/jobs/two");
  expect(rememberedHref(`/_accounts/${"a".repeat(32)}/v2/admin/jobs/one`)).toContain("?tab=money");
  document.body.dataset.viewScope = "different-user-role";
  expect(rememberedHref("/v2/admin/jobs/one")).toBe("/v2/admin/jobs/one");
});
it("full refresh resets temporary views and query state while preserving unrelated drafts", () => {
  sessionStorage.setItem(`${VIEW_MEMORY_PREFIX}${document.body.dataset.viewScope}:/v2/admin/jobs:@query`, JSON.stringify("view=board"));
  sessionStorage.setItem("booking-draft", "keep");
  sessionStorage.setItem(`${VIEW_MEMORY_PREFIX}other:/v2/admin/jobs:@query`, "keep");
  history.replaceState({ preserved: 1 }, "", "/v2/admin/jobs?view=board&other=keep");
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  expect(initializeViewMemory().resetHref).toBe("/v2/admin/jobs?other=keep");
  expect(history.state).toEqual({ preserved: 1 });
  expect(sessionStorage.getItem(viewMemoryKey("/v2/admin/jobs", "@query"))).toBeNull();
  expect(sessionStorage.getItem("booking-draft")).toBe("keep");
  expect(sessionStorage.getItem(`${VIEW_MEMORY_PREFIX}other:/v2/admin/jobs:@query`)).toBe("keep");
});
it("corrupt storage or disabled storage cannot break navigation", () => {
  sessionStorage.setItem(viewMemoryKey("/v2/admin/jobs", "@query"), "{");
  expect(rememberedHref("/v2/admin/jobs")).toBe("/v2/admin/jobs");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  expect(rememberedHref("/v2/admin/jobs")).toBe("/v2/admin/jobs");
});

// Owner report 2026-11-15: on the job page "when I select photos, I can't click and go back to timeline".
// Timeline is the bare job URL; the remembered `?view=photos` was put back on it on every click.
describe("a bare link to the page already open chooses its default view", () => {
  it("lands on the bare URL after a remembered view, and leaving the old view does not overwrite the choice", () => {
    history.replaceState({}, "", "/v2/admin/jobs/job-1?view=photos");
    rememberCurrentView();
    expect(rememberedHref("/v2/admin/jobs/job-1")).toBe("/v2/admin/jobs/job-1?view=photos");

    expect(rememberChosenView("/v2/admin/jobs/job-1")).toBe(true);
    expect(rememberedHref("/v2/admin/jobs/job-1")).toBe("/v2/admin/jobs/job-1");
    // pagehide of the Photos view (a full document navigation) must not put Photos back.
    rememberCurrentView();
    expect(rememberedHref("/v2/admin/jobs/job-1")).toBe("/v2/admin/jobs/job-1");

    // Landed on Timeline: later choices are recorded as usual, back and forth.
    history.replaceState({}, "", "/v2/admin/jobs/job-1");
    settleChosenView();
    rememberCurrentView();
    expect(rememberedHref("/v2/admin/jobs/job-1")).toBe("/v2/admin/jobs/job-1");
    history.replaceState({}, "", "/v2/admin/jobs/job-1?view=answers");
    rememberCurrentView();
    expect(rememberChosenView("/v2/admin/jobs/job-1#s-booking")).toBe(true);
    settleChosenView();
    expect(rememberedHref("/v2/admin/jobs/job-1")).toBe("/v2/admin/jobs/job-1");
  });

  it("keeps returning to the last view from another page, and treats links with a query as before", () => {
    history.replaceState({}, "", "/v2/admin/clients/c-1?tab=invoices");
    rememberCurrentView();
    expect(rememberChosenView("/v2/admin/clients/c-1?open=x")).toBe(false);
    expect(rememberedHref("/v2/admin/clients/c-1?open=x")).toBe("/v2/admin/clients/c-1?open=x&tab=invoices");
    history.replaceState({}, "", "/v2/admin/clients");
    expect(rememberChosenView("/v2/admin/clients/c-1")).toBe(false);
    expect(rememberedHref("/v2/admin/clients/c-1")).toBe("/v2/admin/clients/c-1?tab=invoices");
    expect(rememberChosenView("https://other.invalid/v2/admin/clients")).toBe(false);
    settleChosenView();
  });

  it("matches the open page through a retained-account prefix", () => {
    const prefix = `/_accounts/${"b".repeat(32)}`;
    history.replaceState({}, "", `${prefix}/v2/admin/jobs/job-2?view=clock`);
    rememberCurrentView();
    expect(rememberChosenView(`${prefix}/v2/admin/jobs/job-2`)).toBe(true);
    expect(rememberedHref(`${prefix}/v2/admin/jobs/job-2`)).toBe(`${prefix}/v2/admin/jobs/job-2`);
    settleChosenView();
  });
});
