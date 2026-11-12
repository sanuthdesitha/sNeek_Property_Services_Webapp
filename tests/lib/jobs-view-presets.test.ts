// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { BUILT_IN_VIEWS, activeBuiltInView, builtInViewFilters } from "@/lib/jobs/view-presets";
import { DEFAULT_JOBS_STATE } from "@/lib/jobs/workspace-state";
import { jobsDateScopeRange } from "@/lib/jobs/date-scope";
import { buildJobsQuery } from "@/components/v2/admin/jobs/jobs-query";

const m = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: m.queryRaw } }));
import { loadJobViewCounts, viewCountsSql, viewRuleSql } from "@/lib/jobs/view-counts";

const NOW = new Date("2026-11-11T22:30:00Z"); // 12 Nov 09:30 in Sydney
const sqlText = (sql: Prisma.Sql) => ({ text: sql.sql, values: sql.values });

beforeEach(() => vi.resetAllMocks());

describe("built-in Jobs views", () => {
  it("are defined once with the tab labels of the approved design", () => {
    expect(BUILT_IN_VIEWS.map((view) => view.label)).toEqual(["Today", "Needs a cleaner", "This week", "Awaiting QA", "Not invoiced", "All"]);
  });

  it("apply exactly their filters and clear every other filter", () => {
    const dirty = { ...DEFAULT_JOBS_STATE, search: "Harbour", clientId: "client-1", invoiced: "yes", sort: "property", density: "compact" };
    const needs = { ...dirty, ...builtInViewFilters("needs-cleaner") };
    expect(needs).toMatchObject({ statusChip: "UNASSIGNED,OFFERED", search: "", clientId: "all", invoiced: "all", dateScope: "all" });
    // Display preferences are not filters and survive.
    expect(needs).toMatchObject({ sort: "property", density: "compact" });
    expect(builtInViewFilters("not-invoiced")).toMatchObject({ statusChip: "COMPLETED", invoiced: "no" });
    expect(builtInViewFilters("awaiting-qa").statusChip).toBe("SUBMITTED,QA_REVIEW");
    expect(builtInViewFilters("today").dateScope).toBe("today");
    expect(builtInViewFilters("week").dateScope).toBe("week");
  });

  it("is current only while the filters match the preset exactly", () => {
    expect(activeBuiltInView(DEFAULT_JOBS_STATE)).toBe("all");
    const today = { ...DEFAULT_JOBS_STATE, ...builtInViewFilters("today") };
    expect(activeBuiltInView(today)).toBe("today");
    expect(activeBuiltInView({ ...today, search: "x" })).toBeNull();
    expect(activeBuiltInView({ ...today, sort: "latest", view: "board" })).toBe("today");
  });

  it("produce the same list query a person would build with the filters", () => {
    const query = buildJobsQuery({ ...DEFAULT_JOBS_STATE, ...builtInViewFilters("not-invoiced") });
    expect(Object.fromEntries(query)).toMatchObject({ status: "COMPLETED", invoiced: "no" });
    const week = Object.fromEntries(buildJobsQuery({ ...DEFAULT_JOBS_STATE, ...builtInViewFilters("week") }));
    const range = jobsDateScopeRange("week");
    expect(week).toMatchObject({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  });
});

describe("grouped view counts", () => {
  it("count every view in one query, each with the conditions of its filters", () => {
    const sql = sqlText(viewCountsSql(NOW));
    expect(sql.text.match(/COUNT\(\*\) FILTER/g)).toHaveLength(BUILT_IN_VIEWS.length);
    expect(sql.text).toContain('FROM "Job" j');
    for (const view of BUILT_IN_VIEWS) expect(sql.text).toContain(`AS "${view.id}"`);
  });

  it("uses Sydney-day date keys against the date-only scheduledDate", () => {
    const today = sqlText(viewRuleSql({ dateScope: "today" }, NOW));
    expect(today.values).toEqual([new Date("2026-11-12T00:00:00.000Z"), new Date("2026-11-13T00:00:00.000Z")]);
    const week = sqlText(viewRuleSql({ dateScope: "week" }, NOW));
    expect(week.values).toEqual([new Date("2026-11-12T00:00:00.000Z"), new Date("2026-11-19T00:00:00.000Z")]);
  });

  it("mirrors the Invoice filter for Not invoiced and lists statuses", () => {
    const rule = BUILT_IN_VIEWS.find((view) => view.id === "not-invoiced")!.rule;
    const sql = sqlText(viewRuleSql(rule, NOW));
    expect(sql.values).toEqual(["COMPLETED"]);
    // One invoiced rule (2026-11-11): the INVOICED status alone no longer counts;
    // only a line on a live invoice (kind INVOICE, not VOID, not fully credited).
    expect(sql.text).not.toContain(`<> 'INVOICED'`);
    expect(sql.text).toContain('NOT EXISTS (SELECT 1 FROM "ClientInvoiceLine" l JOIN "ClientInvoice" i ON i."id" = l."invoiceId" WHERE l."jobId" = "j"."id" AND "i"."kind"::text = \'INVOICE\' AND "i"."status"::text <> \'VOID\' AND "i"."creditedInFullAt" IS NULL)');
    expect(sqlText(viewRuleSql({}, NOW)).text).toBe("TRUE");
  });

  it("returns real totals and refuses to invent a missing one", async () => {
    m.queryRaw.mockResolvedValueOnce([{ today: 14, "needs-cleaner": 3, week: 61n, "awaiting-qa": 5, "not-invoiced": 22, all: 128 }]);
    await expect(loadJobViewCounts(NOW)).resolves.toEqual({ today: 14, "needs-cleaner": 3, week: 61, "awaiting-qa": 5, "not-invoiced": 22, all: 128 });
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
    m.queryRaw.mockResolvedValueOnce([{ today: 14 }]);
    await expect(loadJobViewCounts(NOW)).rejects.toThrow("View counts unavailable.");
    m.queryRaw.mockResolvedValueOnce([]);
    await expect(loadJobViewCounts(NOW)).rejects.toThrow("View counts unavailable.");
  });
});
