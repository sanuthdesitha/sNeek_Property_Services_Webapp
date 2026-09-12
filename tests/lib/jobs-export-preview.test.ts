// @vitest-environment node
import { expect, it } from "vitest";
import { jobsExportCsv, parseJobsExport, JOBS_EXPORT_HEADERS } from "@/lib/jobs/export-preview";
const job = (id = "one") => ({ id, jobNumber: `JOB-${id}`, jobType: "GENERAL_CLEAN", status: "ASSIGNED", scheduledDate: "2026-09-09T00:00:00Z", property: { name: "Beach house", suburb: "Sydney", client: { name: "Client" } }, assignments: [{ user: { name: " Alice " } }, { user: { name: "Alice" } }, { user: { email: "other@example.invalid" } }] });
const response = (jobs = [job()], totalCount = jobs.length) => ({ jobs, pagination: { page: 1, limit: 5000, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / 5000)), hasMore: totalCount > 5000 } });
it("preserves the established columns, date-only value and unique cleaner names", () => {
  const result = parseJobsExport(response(), () => "Assigned");
  expect(result.rows[0]).toEqual(["JOB-one", "Beach house", "Sydney", "Client", "GENERAL CLEAN", "Assigned", "09/09/2026", "", "", "Alice, other@example.invalid"]);
  expect(JOBS_EXPORT_HEADERS).toHaveLength(result.rows[0].length); expect(result.truncated).toBe(false);
});
it("discloses the existing 5000 cap without claiming complete export", () => {
  const result = parseJobsExport(response(Array.from({ length: 5000 }, (_, index) => job(String(index))), 5001), value => value);
  expect(result).toMatchObject({ totalCount: 5001, truncated: true }); expect(result.rows).toHaveLength(5000);
});
it("handles legitimate empty results", () => { expect(parseJobsExport(response([]), value => value).rows).toEqual([]); });
it.each([
  { jobs: [] }, response([job(), job()]), response([job()], 2),
  { ...response(), pagination: { ...response().pagination, page: 2 } },
  { ...response(), pagination: { ...response().pagination, totalPages: 2 } },
  { ...response(), pagination: { ...response().pagination, hasMore: true } },
  response([{ ...job(), scheduledDate: "2026-02-31T00:00:00Z" }]),
])("rejects malformed, duplicate, stale or inconsistent exports %j", value => { expect(() => parseJobsExport(value, item => item)).toThrow(); });
it("retains optional field fallbacks without exporting unknown backend columns", () => {
  const result = parseJobsExport(response([{ ...job(), assignments: [{ user: { name: "", email: "" } }], property: { name: "Only name" } as any, client: { name: "Fallback client" } } as any]), value => value);
  expect(result.rows[0][3]).toBe("Fallback client"); expect(result.rows[0][9]).toBe("");
});
it("supports missing optional assignments and client data", () => {
  const result = parseJobsExport(response([{ ...job(), assignments: undefined, property: { name: "Only name" } as any, startTime: "09:00", dueTime: "11:00" } as any]), value => value);
  expect(result.rows[0].slice(7)).toEqual(["09:00", "11:00", ""]); expect(result.rows[0][3]).toBe("");
});
it("quotes commas, quotes, multiline text and spreadsheet formulas safely", () => {
  const csv = jobsExportCsv({ rows: [["a,b", 'Say "hello"', "line1\nline2", "=HYPERLINK(1)", "  +SUM(1)", "@x", "-x", "\tx"]], totalCount: 1, truncated: false, createdAt: "now" });
  expect(csv).toContain('"a,b","Say ""hello""","line1\nline2"'); expect(csv).toContain('"\'=HYPERLINK(1)"'); expect(csv).toContain('"\'  +SUM(1)"'); expect(csv).toContain('"\'\tx"');
});
