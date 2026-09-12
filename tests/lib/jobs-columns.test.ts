import { describe, expect, it } from "vitest";
import { DEFAULT_JOBS_COLUMNS, DEFAULT_JOBS_STATE, jobsSnapshot, jobsSnapshotSchema, readJobsColumns, readJobsState, writeJobsState } from "@/lib/jobs/workspace-state";
import { emptyJobsViews, jobsViewsSchema, jobsViewMutationSchema, storedJobsViewsSchema } from "@/lib/jobs/saved-views";

const subsets = Array.from({ length: 8 }, (_, bits) => ({ client: Boolean(bits & 1), cleaner: Boolean(bits & 2), schedule: Boolean(bits & 4) }));
describe("Jobs columns contract", () => {
  it.each(subsets)("round trips the exact selection %j through URL and snapshot", columns => {
    const state = { ...DEFAULT_JOBS_STATE, columns, page: 3 };
    const url = writeJobsState(new URLSearchParams("other=keep"), state);
    expect(readJobsState(url)).toEqual(state);
    expect(jobsSnapshotSchema.parse(jobsSnapshot(state)).columns).toEqual(columns);
    expect(url.get("other")).toBe("keep");
    expect(readJobsColumns(url).error).toBe(false);
  });
  it("distinguishes absent/all from explicit none and canonicalizes valid order", () => {
    expect(readJobsColumns(new URLSearchParams())).toEqual({ columns: DEFAULT_JOBS_COLUMNS, error: false });
    expect(readJobsColumns(new URLSearchParams("columns=none")).columns).toEqual(subsets[0]);
    const state = readJobsState(new URLSearchParams("columns=schedule,client"));
    expect(writeJobsState(new URLSearchParams(), state).get("columns")).toBe("client,schedule");
    expect(writeJobsState(new URLSearchParams(), DEFAULT_JOBS_STATE).has("columns")).toBe(false);
  });
  it.each(["", "client,", "client,unknown", "client,client", "none,client", "Client", "true", "[]"])("flags malformed URL columns %s", value => {
    expect(readJobsColumns(new URLSearchParams({ columns: value })).error).toBe(true);
  });
  it("rejects repeated URL columns instead of picking one", () => {
    expect(readJobsColumns(new URLSearchParams("columns=client&columns=schedule")).error).toBe(true);
  });
  it.each([null, [], "client", {}, { client: true }, { client: true, cleaner: false, schedule: "false" },
    { ...DEFAULT_JOBS_COLUMNS, property: false }])("rejects present malformed columns %j on stored reads and mutations", columns => {
    const snapshot = { ...jobsSnapshot(DEFAULT_JOBS_STATE), columns };
    const envelope = { ...emptyJobsViews(), views: [{ id: "11111111-1111-4111-8111-111111111111", name: "Keep", snapshot }] };
    expect(storedJobsViewsSchema.safeParse(envelope).success).toBe(false);
    expect(jobsViewMutationSchema.safeParse({ revision: 0, change: { action: "create", name: "Keep", snapshot } }).success).toBe(false);
  });
  it("normalizes only missing columns in stored v1 snapshots, preserving the complete envelope", () => {
    const { columns: _columns, ...legacy } = jobsSnapshot({ ...DEFAULT_JOBS_STATE, sort: "property", search: "Keep this" });
    const id = "11111111-1111-4111-8111-111111111111";
    const old = { ...emptyJobsViews(), revision: 9, defaultId: id, views: [{ id, name: "My view", snapshot: legacy }] };
    const before = JSON.stringify(old);
    expect(storedJobsViewsSchema.parse(old)).toEqual({ ...old, views: [{ ...old.views[0], snapshot: { ...legacy, columns: DEFAULT_JOBS_COLUMNS } }] });
    expect(JSON.stringify(old)).toBe(before);
    expect(jobsViewsSchema.safeParse(old).success).toBe(false);
    expect(jobsViewMutationSchema.safeParse({ revision: 9, change: { action: "update", id, snapshot: legacy } }).success).toBe(false);
    expect(storedJobsViewsSchema.safeParse({ ...old, version: 2 }).success).toBe(false);
    expect(storedJobsViewsSchema.safeParse({ ...old, views: [{ ...old.views[0], snapshot: { ...legacy, sort: "invalid" } }] }).success).toBe(false);
  });
});
