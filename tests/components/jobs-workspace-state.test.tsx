import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";
import { DEFAULT_JOBS_STATE, readJobsState, useJobsWorkspaceState, writeJobsState } from "@/components/v2/admin/jobs/use-jobs-workspace-state";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

beforeEach(() => window.history.replaceState({ nextMarker: "preserve" }, "", "/v2/admin/jobs"));

describe("Jobs URL state", () => {
  it("round trips every view field while preserving unrelated parameters", () => {
    const state = { ...DEFAULT_JOBS_STATE, dateScope: "past", statusChip: "COMPLETED", sort: "latest",
      search: "Harbour & client + 42", view: "board", jobType: Object.values(JobType)[0], clientId: "client-1",
      propertyId: "property-1", cleanerId: "unassigned", dateFrom: "2024-02-29", dateTo: "2026-09-09", invoiced: "yes", page: 3 };
    const params = writeJobsState(new URLSearchParams("other=keep"), state);
    expect(readJobsState(params)).toEqual(state);
    expect(params.get("other")).toBe("keep");
    expect(writeJobsState(params, DEFAULT_JOBS_STATE).toString()).toBe("other=keep");
  });

  it.each(["0", "-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992", "42949673", "01"])("rejects invalid page %s", page => {
    expect(readJobsState(new URLSearchParams({ page })).page).toBe(1);
  });

  it("rejects unknown enums, malformed identifiers, impossible and reversed dates", () => {
    expect(readJobsState(new URLSearchParams({ dateScope: "bad", statusChip: "bad", sort: "bad", view: "bad",
      jobType: "bad", invoiced: "bad", clientId: "../../admin", dateFrom: "2025-02-29", dateTo: "2026-13-01" }))).toEqual(DEFAULT_JOBS_STATE);
    expect(readJobsState(new URLSearchParams("dateFrom=2026-09-10&dateTo=2026-09-01"))).toEqual(DEFAULT_JOBS_STATE);
    expect(readJobsState(new URLSearchParams("dateFrom=0000-01-01&dateTo=2026-9-1"))).toEqual(DEFAULT_JOBS_STATE);
  });

  it("restores on remount and browser Back without losing page or framework history state", async () => {
    window.history.replaceState({ nextMarker: "preserve" }, "", "/v2/admin/jobs?other=keep#ledger");
    const first = renderHook(useJobsWorkspaceState);
    act(() => first.result.current.update({ statusChip: "QA_REVIEW", cleanerId: "unassigned", sort: "latest" }));
    act(() => first.result.current.update({ search: "Unit & 5", view: "board", invoiced: "no" }));
    act(() => first.result.current.update({ page: 3 }));
    const saved = first.result.current.state;
    const listUrl = window.location.href;
    expect(window.history.state).toEqual({ nextMarker: "preserve" });
    expect(window.location.hash).toBe("#ledger");
    first.unmount();
    const reloaded = renderHook(useJobsWorkspaceState);
    expect(reloaded.result.current.state).toEqual(saved);
    reloaded.unmount();
    window.history.pushState({}, "", "/v2/admin/jobs/detail-1");
    await act(async () => {
      await new Promise<void>(resolve => {
        window.addEventListener("popstate", () => resolve(), { once: true });
        window.history.back();
      });
    });
    expect(window.location.href).toBe(listUrl);
    const returned = renderHook(useJobsWorkspaceState);
    expect(returned.result.current.state).toEqual(saved);
    act(() => returned.result.current.update({ propertyId: "property-2" }));
    expect(returned.result.current.state.page).toBe(1);
  });

  it("handles popstate while mounted and writes consecutive updates atomically", () => {
    const hook = renderHook(useJobsWorkspaceState);
    act(() => {
      hook.result.current.update({ sort: "property" });
      hook.result.current.update({ page: 4, view: "board" });
    });
    expect(hook.result.current.state).toMatchObject({ sort: "property", page: 4, view: "board" });
    act(() => {
      window.history.replaceState({}, "", "/v2/admin/jobs?sort=created&page=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(hook.result.current.state).toMatchObject({ sort: "created", page: 2, view: "list" });
  });

  it.each([{ search: "Harbour" }, { invoiced: "yes" }])("resets page for refinement %j but preserves it for view changes", patch => {
    window.history.replaceState({}, "", "/v2/admin/jobs?page=4&other=keep");
    const hook = renderHook(useJobsWorkspaceState);
    act(() => hook.result.current.update({ view: "board" }));
    expect(hook.result.current.state.page).toBe(4);
    act(() => hook.result.current.update(patch));
    expect(hook.result.current.state.page).toBe(1);
    expect(new URLSearchParams(window.location.search).get("other")).toBe("keep");
    act(() => hook.result.current.update({ page: 2 }));
    act(() => hook.result.current.update(patch));
    expect(hook.result.current.state.page).toBe(2);
  });

  it("bounds restored and typed search", () => {
    expect(readJobsState(new URLSearchParams({ search: "x".repeat(250) })).search).toHaveLength(200);
    const hook = renderHook(useJobsWorkspaceState);
    act(() => hook.result.current.update({ search: "x".repeat(250) }));
    expect(hook.result.current.state.search).toHaveLength(200);
    expect(new URLSearchParams(window.location.search).get("search")).toHaveLength(200);
  });
});
