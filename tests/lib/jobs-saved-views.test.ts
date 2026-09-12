import { describe, expect, it } from "vitest";
import { DEFAULT_JOBS_STATE, jobsSnapshot, jobsSnapshotSchema, readJobsState, writeJobsState } from "@/lib/jobs/workspace-state";
import { emptyJobsViews, jobsViewMutationSchema, jobsViewsSchema, viewNameSchema } from "@/lib/jobs/saved-views";

describe("Jobs saved view validation", () => {
  it("round trips every snapshot field exactly, excluding the page", () => {
    const state = { ...DEFAULT_JOBS_STATE, search: "Harbour & + 5", dateScope: "today", statusChip: "active",
      clientId: "client-1", propertyId: "prop_2", cleanerId: "unassigned", jobType: "all",
      sort: "property", view: "board", invoiced: "no", density: "compact", page: 8 };
    expect(readJobsState(writeJobsState(new URLSearchParams(), state))).toEqual(state);
    const snapshot = jobsSnapshot(state);
    const { page: _page, ...expected } = state;
    expect(snapshot).toEqual(expected);
    expect(snapshot).not.toHaveProperty("page");
  });

  it.each(["page", "selectedIds", "dialog", "ownerId", "teamId"])("rejects extra snapshot field %s", key => {
    expect(jobsSnapshotSchema.safeParse({ ...jobsSnapshot(DEFAULT_JOBS_STATE), [key]: "unexpected" }).success).toBe(false);
  });
  it.each([
    { sort: "unknown" }, { density: "tiny" }, { dateFrom: "2026-02-30" },
    { dateFrom: "2026-10-02", dateTo: "2026-10-01" }, { clientId: "../owner" }, { search: "x".repeat(201) },
  ])("rejects invalid saved values without silently sanitizing %j", patch => {
    expect(jobsSnapshotSchema.safeParse({ ...jobsSnapshot(DEFAULT_JOBS_STATE), ...patch }).success).toBe(false);
  });
  it("bounds names and requires a complete snapshot", () => {
    expect(viewNameSchema.parse("  My view  ")).toBe("My view");
    expect(viewNameSchema.safeParse(" ").success).toBe(false);
    expect(viewNameSchema.safeParse("x".repeat(61)).success).toBe(false);
    expect(viewNameSchema.safeParse("x".repeat(60)).success).toBe(true);
    expect(jobsSnapshotSchema.safeParse({ sort: "latest" }).success).toBe(false);
    expect(jobsViewMutationSchema.safeParse({ revision: 0, ownerId: "other", change: { action: "default", id: null } }).success).toBe(false);
  });
  it("rejects duplicate IDs/names, dangling defaults, unknown versions and oversized collections", () => {
    const view = { id: "11111111-1111-4111-8111-111111111111", name: "Morning", snapshot: jobsSnapshot(DEFAULT_JOBS_STATE) };
    for (const patch of [
      { views: [view, view] }, { views: [view, { ...view, id: "22222222-2222-4222-8222-222222222222", name: "morning" }] },
      { defaultId: view.id }, { version: 2 }, { views: Array(21).fill(view) },
    ]) expect(jobsViewsSchema.safeParse({ ...emptyJobsViews(), ...patch }).success).toBe(false);
  });
});
