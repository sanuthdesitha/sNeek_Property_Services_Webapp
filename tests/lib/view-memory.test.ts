import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initializeViewMemory, rememberedHref, rememberCurrentView, viewMemoryKey, VIEW_MEMORY_PREFIX } from "@/lib/navigation/view-memory";
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
