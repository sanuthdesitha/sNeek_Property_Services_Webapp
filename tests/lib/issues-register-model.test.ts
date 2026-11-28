/** All issues register: filters, case classification, figures (unknown is never zero). */
import { describe, expect, it } from "vitest";
import {
  EMPTY_REGISTER_FILTERS,
  RegisterQueryError,
  applyRegisterFilters,
  classifyCase,
  computeRegisterStats,
  monthKeyIn,
  parseRegisterFilters,
  registerFacets,
  sortRegisterRows,
  writeRegisterFilters,
  type RegisterRow,
} from "@/lib/quality/register/model";
import { registerHistoryHref } from "@/lib/quality/register/history";
import { registerAllowedSources, registerCanLog } from "@/lib/quality/register/access";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const NOW = new Date("2026-11-28T00:00:00Z");

function row(overrides: Partial<RegisterRow>): RegisterRow {
  return {
    key: `QA_INSPECTION:${overrides.recordId ?? "x"}`,
    source: "QA_INSPECTION",
    recordId: "x",
    date: "2026-11-27T12:00:00Z",
    title: "Smudges on mirror",
    detail: null,
    propertyId: "p1",
    propertyName: "Harbour View",
    clientId: "c1",
    clientName: "Acme",
    cleaners: [{ id: "u1", name: "Ana" }],
    jobId: "j1",
    jobNumber: "J-1",
    category: "bathroom",
    categoryLabel: "Bathroom",
    severity: "HIGH",
    severityLabel: "Major",
    open: true,
    statusLabel: "Pending",
    closedAt: null,
    closedBy: null,
    href: "/v2/admin/quality?tab=issues&q=x",
    ...overrides,
  };
}

describe("filters in the URL", () => {
  it("round-trips and refuses unknown values strictly, drops them leniently", () => {
    const params = writeRegisterFilters(new URLSearchParams(), { ...EMPTY_REGISTER_FILTERS, source: "DAMAGE", status: "overdue", level: "CRITICAL", clientId: "c1", q: "mirror" });
    expect(parseRegisterFilters(params, true)).toMatchObject({ source: "DAMAGE", status: "overdue", level: "CRITICAL", clientId: "c1", q: "mirror" });
    const bad = new URLSearchParams("source=NOPE&status=late");
    expect(() => parseRegisterFilters(bad, true)).toThrow(RegisterQueryError);
    expect(parseRegisterFilters(bad, false)).toMatchObject({ source: "", status: "" });
  });
});

describe("which source a case is", () => {
  it("classifies by type and source; skips lost and found and damage-report item cases", () => {
    expect(classifyCase({ caseType: "CLIENT_DISPUTE", source: "ADMIN" })).toBe("CLIENT_COMPLAINT");
    expect(classifyCase({ caseType: "OTHER", source: "CLIENT_PORTAL" })).toBe("CLIENT_COMPLAINT");
    expect(classifyCase({ caseType: "DAMAGE", source: "CLEANER_SUBMIT" })).toBe("CLEANER_REPORT");
    expect(classifyCase({ caseType: "SLA", source: null })).toBe("AUTOMATIC");
    expect(classifyCase({ caseType: "OPS", source: "ISSUES_REGISTER" })).toBe("OFFICE");
    expect(classifyCase({ caseType: "LOST_FOUND", source: "ADMIN" })).toBeNull();
    expect(classifyCase({ caseType: "DAMAGE", source: "DAMAGE_REPORT" })).toBeNull();
  });
});

describe("filtering and sorting", () => {
  const rows = [
    row({ recordId: "a", key: "QA_INSPECTION:a", date: "2026-11-20T00:00:00Z" }),
    row({ recordId: "b", key: "STOCK:b", source: "STOCK", severity: null, date: "2026-11-27T20:00:00Z", cleaners: [] }),
    row({ recordId: "c", key: "DAMAGE:c", source: "DAMAGE", open: false, closedAt: "2026-11-21T00:00:00Z", propertyId: "p2", propertyName: "Beach", clientId: "c2" }),
  ];

  it("open / fixed / overdue (48 h) and combinable facets", () => {
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, status: "overdue" }, NOW).map((r) => r.recordId)).toEqual(["a"]);
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, status: "fixed" }, NOW).map((r) => r.recordId)).toEqual(["c"]);
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, status: "open", cleanerId: "u1" }, NOW).map((r) => r.recordId)).toEqual(["a"]);
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, level: "HIGH", clientId: "c2" }, NOW).map((r) => r.recordId)).toEqual(["c"]);
    // An ungraded source never matches a severity filter (it is not "low").
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, level: "LOW" }, NOW)).toEqual([]);
    expect(applyRegisterFilters(rows, { ...EMPTY_REGISTER_FILTERS, q: "beach" }, NOW).map((r) => r.recordId)).toEqual(["c"]);
  });

  it("sorts by date, age and severity with a stable tie-break", () => {
    expect(sortRegisterRows(rows, "date", "desc", NOW).map((r) => r.recordId)).toEqual(["b", "c", "a"]);
    expect(sortRegisterRows(rows, "age", "desc", NOW).map((r) => r.recordId)).toEqual(["a", "b", "c"]);
    expect(sortRegisterRows(rows, "severity", "asc", NOW)[0].recordId).toBe("b");
  });
});

describe("figures", () => {
  it("averages only recorded fix times and counts the rest as unknown", () => {
    const stats = computeRegisterStats(
      [
        row({ recordId: "a", open: false, date: "2026-11-20T00:00:00Z", closedAt: "2026-11-21T00:00:00Z" }),
        row({ recordId: "b", open: false, date: "2026-11-20T00:00:00Z", closedAt: null }),
        row({ recordId: "c", open: true, date: "2026-11-27T23:00:00Z" }),
      ],
      NOW,
      "Australia/Sydney",
    );
    expect(stats).toMatchObject({ total: 3, open: 1, overdue: 0, averageFixHours: 24, fixTimesKnown: 1, fixTimesUnknown: 1 });
  });

  it("no closed issue with a time = unknown, not zero hours", () => {
    const stats = computeRegisterStats([row({ open: false, closedAt: null })], NOW, "Australia/Sydney");
    expect(stats.averageFixHours).toBeNull();
  });

  it("repeats: same category at one property or by one cleaner, twice or more", () => {
    const stats = computeRegisterStats(
      [
        row({ recordId: "a", key: "k:a" }),
        row({ recordId: "b", key: "k:b", propertyId: "p2", propertyName: "Beach" }),
        row({ recordId: "c", key: "k:c", category: "kitchen", categoryLabel: "Kitchen" }),
      ],
      NOW,
      "Australia/Sydney",
    );
    expect(stats.repeats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cleaner", id: "u1", category: "bathroom", count: 2 }),
      ]),
    );
    expect(stats.repeats.some((repeat) => repeat.kind === "property" && repeat.category === "bathroom")).toBe(false);
  });

  it("months are in the organisation time zone", () => {
    // 30 Nov 14:00 UTC is 1 Dec in Sydney.
    expect(monthKeyIn("2026-11-30T14:00:00Z", "Australia/Sydney")).toBe("2026-12");
    expect(monthKeyIn("2026-11-30T14:00:00Z", "UTC")).toBe("2026-11");
    const stats = computeRegisterStats([row({ date: "2026-11-30T14:00:00Z", open: false, closedAt: "2026-12-02T00:00:00Z" })], NOW, "Australia/Sydney");
    expect(stats.months).toEqual([{ month: "2026-12", raised: 1, closed: 1 }]);
  });

  it("facets list what occurs in the period", () => {
    const facets = registerFacets([row({}), row({ propertyId: "p2", propertyName: "Beach", clientId: null, clientName: null })]);
    expect(facets.properties.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(facets.clients).toEqual([{ id: "c1", label: "Acme" }]);
  });
});

describe("access and links", () => {
  it("an operations manager sees only the sources their packs include; ADMIN all", () => {
    expect(registerAllowedSources(null).size).toBe(8);
    const levels = { ...allOpsLevels("off"), quality: "manage" as const };
    expect(Array.from(registerAllowedSources(levels))).toEqual(["QA_INSPECTION"]);
    expect(registerCanLog(levels)).toBe(false);
    expect(registerCanLog({ ...levels, cases: "manage" })).toBe(true);
    expect(registerCanLog({ ...levels, quality: "read", cases: "manage" })).toBe(false);
    expect(registerCanLog(null)).toBe(true);
  });

  it("history links are the register pre-filtered for 12 months", () => {
    expect(registerHistoryHref({ propertyId: "p1" }, NOW)).toBe("/v2/admin/quality?tab=register&period=custom&from=2025-11-29&to=2026-11-28&propertyId=p1");
    expect(registerHistoryHref({ cleanerId: "u1" }, NOW)).toContain("cleanerId=u1");
  });
});
