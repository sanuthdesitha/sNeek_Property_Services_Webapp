// @vitest-environment node
/**
 * Parity (2026-11-12): People › Cleaners restores the old Cleaners roster's
 * per-cleaner Customer rating, Reliability, Attendance and Hours (30 d), their
 * sorts, and the "Avg quality" / "Avg rating" header figures, read through the
 * roster's own service (lib/workforce/performance) and never shown as 0 when
 * there is no figure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRecord } from "@/lib/accounts/list/derive";

const m = vi.hoisted(() => ({
  metrics: vi.fn(),
  db: {
    timeLog: { groupBy: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn(async () => 2) },
    jobAssignment: { count: vi.fn(async () => 4) },
    cleanerPayAdjustment: { aggregate: vi.fn(async () => ({ _sum: { approvedAmount: 0 } })) },
    learningAssignment: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/workforce/performance", async (load) => ({
  ...(await load<typeof import("@/lib/workforce/performance")>()),
  getPerformanceMetrics: m.metrics,
}));
vi.mock("@/lib/workforce/service", () => ({
  getRecognitionBoard: async () => ({ recentRecognitions: [] }),
  listStaffDocumentsForAdmin: async () => [],
  listStaffDocumentRequestsForAdmin: async () => [],
}));

import { emptyPerformanceMetrics } from "@/lib/workforce/performance";
import { averageOf, loadCleanerPerformance, resetCleanerPerformanceCache, type CleanerPerformanceMap } from "@/lib/accounts/list/performance";
import { buildRow, sortRows } from "@/lib/accounts/list/derive";
import { parseAccountListQuery } from "@/lib/accounts/list/types";
import { accountsCsv } from "@/lib/accounts/list/csv";
import { loadCleanerFigures } from "@/lib/people/cleaner-figures";
import { ALL_COLUMN_PREFS, DEFAULT_COLUMN_PREFS, allowedColumns, accountColumns } from "@/components/v2/admin/accounts/hub/accounts-columns";
import { defaultPrefs } from "@/components/v2/admin/people/account-list-tab";

const NOW = new Date("2026-11-12T02:00:00Z");
const WITH_PERFORMANCE = { pay: true, quality: true, performance: true };

function record(id: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    phone: null,
    role: "CLEANER",
    isActive: true,
    emailVerified: NOW,
    invitation: null,
    documents: [],
    missingDocuments: [],
    credentials: {},
    upcomingAssignments: 0,
    extraRoles: [],
    twoFactorEnabled: false,
    clientName: null,
    hourlyRate: 30,
    lastSeenAt: null,
    ...overrides,
  };
}

function metricsFor(userId: string, figures: { quality?: number | null; rating?: number | null; reliability?: number | null; attendance?: number | null }) {
  const base = emptyPerformanceMetrics(userId, 30);
  return {
    ...base,
    quality: { score: figures.quality ?? null, sampleSize: 1 },
    customerSatisfaction: { avgRating: figures.rating ?? null, sampleSize: 1 },
    reliability: { onTimePercent: figures.reliability ?? null, sampleSize: 1 },
    attendance: { completedJobs: 1, assignedJobs: 1, percent: figures.attendance ?? null },
  };
}

beforeEach(() => {
  resetCleanerPerformanceCache();
  m.metrics.mockReset();
  m.db.timeLog.groupBy.mockReset();
  m.db.user.findMany.mockReset();
});

describe("loading the old roster's figures", () => {
  it("reads rating, reliability, attendance and quality from getPerformanceMetrics(id, 30) and hours from time logs", async () => {
    m.metrics.mockImplementation(async (id: string) => (id === "a" ? metricsFor("a", { quality: 90, rating: 4.5, reliability: 80, attendance: 100 }) : emptyPerformanceMetrics(id, 30)));
    m.db.timeLog.groupBy.mockResolvedValue([{ userId: "a", _sum: { durationM: 125 } }]);
    const figures = await loadCleanerPerformance(["a", "b"], NOW);
    expect(m.metrics).toHaveBeenCalledWith("a", 30);
    expect(figures.get("a")).toEqual({ quality: 90, rating: 4.5, reliability: 80, attendance: 100, hours30: 2.1 });
    // No data: null figures, a real 0 hours (the log query worked).
    expect(figures.get("b")).toEqual({ quality: null, rating: null, reliability: null, attendance: null, hours30: 0 });
  });

  it("gives null (not 0) when a cleaner's metrics fail or the time logs cannot be read", async () => {
    m.metrics.mockRejectedValue(new Error("boom"));
    m.db.timeLog.groupBy.mockRejectedValue(new Error("db down"));
    const figures = await loadCleanerPerformance(["a"], NOW);
    expect(figures.get("a")).toEqual({ quality: null, rating: null, reliability: null, attendance: null, hours30: null });
  });

  it("reuses the figures for the same cleaners for a short time (header, then the list)", async () => {
    m.metrics.mockImplementation(async (id: string) => emptyPerformanceMetrics(id, 30));
    m.db.timeLog.groupBy.mockResolvedValue([]);
    await loadCleanerPerformance(["b", "a"], NOW);
    await loadCleanerPerformance(["a", "b", "a"], NOW);
    expect(m.metrics).toHaveBeenCalledTimes(2);
  });

  it("averages only the figures that exist; none is null", () => {
    expect(averageOf([80, null, 90])).toBe(85);
    expect(averageOf([null, null])).toBeNull();
    expect(averageOf([])).toBeNull();
  });
});

describe("list rows, sorts and CSV", () => {
  const performance: CleanerPerformanceMap = new Map([
    ["a", { quality: 90, rating: 4.8, reliability: 70, attendance: 100, hours30: 12.5 }],
    ["b", { quality: null, rating: 3.9, reliability: null, attendance: 50, hours30: 0 }],
  ]);

  it("adds the figures only for viewers with performance visibility, null for non-cleaners", () => {
    const row = buildRow(record("a"), new Map(), WITH_PERFORMANCE, NOW, performance);
    expect(row).toMatchObject({ rating: 4.8, reliability: 70, attendance: 100, hours30: 12.5 });
    const office = buildRow(record("o", { role: "ADMIN" }), new Map(), WITH_PERFORMANCE, NOW, performance);
    expect(office).toMatchObject({ rating: null, reliability: null, attendance: null, hours30: null });
    const hidden = buildRow(record("a"), new Map(), { pay: true, quality: true }, NOW, performance);
    expect("rating" in hidden || "reliability" in hidden || "attendance" in hidden || "hours30" in hidden).toBe(false);
  });

  it("sorts by customer rating, reliability, attendance and hours with missing figures last", () => {
    const rows = ["a", "b", "c"].map((id) => buildRow(record(id), new Map(), WITH_PERFORMANCE, NOW, performance));
    expect(sortRows(rows, "rating", "desc").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "rating", "asc").map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "reliability", "asc").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "attendance", "desc").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "hours30", "asc").map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("accepts the new sorts only with performance visibility; an unknown sort is still refused", () => {
    for (const sort of ["rating", "reliability", "attendance", "hours30", "qa30", "jobs30"]) {
      expect(parseAccountListQuery(new URLSearchParams(`sort=${sort}`), WITH_PERFORMANCE).sort).toBe(sort);
    }
    expect(() => parseAccountListQuery(new URLSearchParams("sort=rating"), { pay: true, quality: true })).toThrow(/Cannot sort|sort/i);
    expect(() => parseAccountListQuery(new URLSearchParams("sort=nonsense"), WITH_PERFORMANCE)).toThrow();
  });

  it("writes the new columns to the CSV, empty (never 0) when there is no figure", () => {
    const rows = ["a", "c"].map((id) => buildRow(record(id), new Map(), WITH_PERFORMANCE, NOW, performance));
    const [header, first, second] = accountsCsv(rows, WITH_PERFORMANCE).trim().split("\r\n");
    expect(header).toContain('"Customer rating, 30 d","Reliability %, 30 d","Attendance %, 30 d","Hours, 30 d"');
    expect(first).toContain("4.8,70,100,12.5");
    // Cleaner "c" has no figures: four empty cells after QA, never 0.
    expect(second).toMatch(/,0,,,,,,/);
    expect(accountsCsv(rows, { pay: true, quality: true })).not.toContain("Customer rating");
  });
});

describe("columns", () => {
  it("offers the four columns only with performance visibility", () => {
    expect(allowedColumns(WITH_PERFORMANCE)).toEqual(expect.arrayContaining(["rating", "reliability", "attendance", "hours30"]));
    expect(allowedColumns({ pay: true, quality: true })).not.toEqual(expect.arrayContaining(["rating"]));
  });

  it("shows Customer rating and Reliability by default on People › Cleaners only; Show all turns every column on", () => {
    expect(defaultPrefs("cleaners")).toMatchObject({ rating: true, reliability: true, attendance: false, hours30: false });
    expect(defaultPrefs("everyone")).toMatchObject({ rating: false, reliability: false });
    expect(DEFAULT_COLUMN_PREFS.rating).toBe(false);
    expect(Object.values(ALL_COLUMN_PREFS).every(Boolean)).toBe(true);
    const headers = accountColumns(WITH_PERFORMANCE, defaultPrefs("cleaners"), () => undefined).map((column) => column.header);
    expect(headers).toEqual(expect.arrayContaining(["Customer rating", "Reliability"]));
    expect(headers).not.toContain("Attendance");
  });
});

describe("Cleaners header figures", () => {
  it("averages quality and rating over active cleaners as the roster did, with the workforce pack", async () => {
    m.db.user.findMany.mockResolvedValue([
      { id: "a", isActive: true },
      { id: "b", isActive: true },
      { id: "x", isActive: false },
    ]);
    m.db.timeLog.groupBy.mockResolvedValue([]);
    m.metrics.mockImplementation(async (id: string) => {
      if (id === "a") return metricsFor("a", { quality: 80, rating: 4 });
      if (id === "b") return metricsFor("b", { quality: 90, rating: null });
      return metricsFor("x", { quality: 10, rating: 1 });
    });
    const figures = await loadCleanerFigures({ workforce: true, pay: true }, NOW);
    expect(figures.avgQuality).toBe(85);
    expect(figures.avgRating).toBe(4);
  });

  it("shows no average without data or without the workforce pack", async () => {
    m.db.user.findMany.mockResolvedValue([{ id: "a", isActive: true }]);
    m.db.timeLog.groupBy.mockResolvedValue([]);
    m.metrics.mockImplementation(async (id: string) => emptyPerformanceMetrics(id, 30));
    const empty = await loadCleanerFigures({ workforce: true, pay: true }, NOW);
    expect(empty.avgQuality).toBeNull();
    expect(empty.avgRating).toBeNull();
    resetCleanerPerformanceCache();
    const noPack = await loadCleanerFigures({ workforce: false, pay: true }, NOW);
    expect(noPack.avgQuality).toBeNull();
    expect(m.metrics).toHaveBeenCalledTimes(1);
  });
});
