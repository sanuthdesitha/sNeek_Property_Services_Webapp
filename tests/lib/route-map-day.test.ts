// @vitest-environment node
/**
 * Route map day (board "Route map", 2026-11-17): routes follow the Scheduling
 * rules exactly as on origin/main (owner instruction), the stops the limit
 * hides are counted and said, and the "Nobody on these jobs" suggestions come from the
 * existing scorer WITHOUT writing anything. The API keeps today's rights:
 * ADMIN and OPS_MANAGER, and the Jobs pack for managers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  routeAssignments: [] as unknown[],
  unassigned: [] as unknown[],
  properties: [] as unknown[],
  cleaners: [] as unknown[],
  writes: [] as string[],
  requireRole: vi.fn(),
}));

function writeSpy(name: string) {
  return vi.fn(async () => {
    m.writes.push(name);
    return {};
  });
}

vi.mock("@/lib/db", () => {
  const model = (reads: Record<string, unknown>) => ({
    ...reads,
    create: writeSpy("create"), createMany: writeSpy("createMany"), update: writeSpy("update"), updateMany: writeSpy("updateMany"),
    upsert: writeSpy("upsert"), delete: writeSpy("delete"), deleteMany: writeSpy("deleteMany"),
  });
  return {
    db: {
      jobAssignment: model({
        findMany: vi.fn(async (args: { include?: unknown }) => (args.include ? m.routeAssignments : [{ userId: "c-sofia", jobId: "other" }])),
      }),
      job: model({
        findMany: vi.fn(async (args: { where: { assignments?: unknown } }) => (args.where.assignments ? m.unassigned : [{ assignments: [{ userId: "c-sofia" }] }])),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, jobType: "AIRBNB_TURNOVER", propertyId: "p", scheduledDate: new Date("2026-11-15T00:00:00Z"), property: { suburb: "Rose Bay", name: "Rose Bay Villa" } })),
      }),
      user: model({ findMany: vi.fn(async () => m.cleaners) }),
      property: model({ findMany: vi.fn(async () => m.properties) }),
      qAReview: model({ findMany: vi.fn(async () => [{ score: 91.4, job: { assignments: [{ userId: "c-sofia" }] } }]) }),
      auditLog: model({}),
      $transaction: writeSpy("$transaction"),
    },
  };
});
vi.mock("@/lib/accounts/availability", () => ({ listCleanerAvailabilities: async () => [] }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/settings", async (original) => {
  const actual = await original<typeof import("@/lib/settings")>();
  return { ...actual, getAppSettings: async () => actual.DEFAULT_SETTINGS };
});

import { buildDailyRoutePlan, buildDetailedRoutePlan } from "@/lib/ops/dispatch";
import { loadRouteMapDay } from "@/lib/ops/route-map-day";
import { GET } from "@/app/api/admin/jobs/route-map/route";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";

function assignment(index: number, startTime: string, suburb: string) {
  return {
    userId: "c-maria",
    user: { id: "c-maria", name: "Maria Santos", email: "maria@x" },
    job: {
      id: `job-${index}`, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", startTime, dueTime: null, propertyId: `p-${index}`,
      property: { name: `Property ${index}`, suburb, address: `${index} Test St`, latitude: index % 2 ? -33.9 : null, longitude: index % 2 ? 151.25 : null },
      assignments: [{ userId: "c-maria", isPrimary: true }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.writes = [];
  m.properties = [{ suburb: "Bondi", latitude: -33.89, longitude: 151.27 }];
  m.cleaners = [{ id: "c-maria", name: "Maria Santos", email: "maria@x" }, { id: "c-sofia", name: "Sofia Alvarez", email: "sofia@x" }];
  // 14 stops whose suburbs sort the opposite way to their start times.
  m.routeAssignments = Array.from({ length: 14 }, (_, index) => assignment(index + 1, `${String(7 + index).padStart(2, "0")}:00`, `Suburb ${String.fromCharCode(90 - index)}`));
  m.unassigned = [{
    id: "job-rose", jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", startTime: "10:00", dueTime: "13:00", sameDayCheckinTime: "15:00", internalNotes: null, cleanSkipStatus: null,
    property: { name: "Rose Bay Villa", suburb: "Rose Bay", address: "8 Vickery Ave", latitude: -33.87, longitude: 151.26 },
  }];
  m.requireRole.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
});

/**
 * origin/main's buildDailyRoutePlan, copied verbatim (grouping, sort, travel,
 * slice) as the reference: the owner's rules must behave exactly as before.
 */
type OriginRow = { userId: string; user: { id: string; name: string | null; email: string }; job: { id: string; jobType: string; status: string; startTime: string | null; dueTime: string | null; property: { name: string; suburb: string; address: string } } };
function originRoutePlan(assignments: OriginRow[], settings: { routeOptimization: { groupBySuburb: boolean; maxStopsPerRun: number } }) {
  const groups = new Map<string, { cleanerId: string; cleanerName: string; cleanerEmail: string; stops: Array<{ jobId: string; propertyName: string; suburb: string; address: string; startTime: string | null; dueTime: string | null; jobType: string; status: string; estimatedTravelMinsFromPrev: number }>; totalEstimatedTravelMins: number }>();
  for (const row of assignments) {
    const key = row.userId;
    const current = groups.get(key) ?? { cleanerId: row.user.id, cleanerName: row.user.name ?? row.user.email, cleanerEmail: row.user.email, stops: [], totalEstimatedTravelMins: 0 };
    current.stops.push({ jobId: row.job.id, propertyName: row.job.property.name, suburb: row.job.property.suburb, address: row.job.property.address, startTime: row.job.startTime ?? null, dueTime: row.job.dueTime ?? null, jobType: row.job.jobType, status: row.job.status, estimatedTravelMinsFromPrev: 0 });
    groups.set(key, current);
  }
  const routes = Array.from(groups.values()).map((group) => {
    const sortedStops = [...group.stops].sort((a, b) => {
      if (settings.routeOptimization.groupBySuburb) {
        const suburbCompare = a.suburb.localeCompare(b.suburb);
        if (suburbCompare !== 0) return suburbCompare;
      }
      return (a.startTime ?? "23:59").localeCompare(b.startTime ?? "23:59");
    });
    let totalTravel = 0;
    for (let index = 0; index < sortedStops.length; index += 1) {
      if (index === 0) continue;
      const prev = sortedStops[index - 1];
      const curr = sortedStops[index];
      const estimated = prev.suburb === curr.suburb ? 8 : 22;
      curr.estimatedTravelMinsFromPrev = estimated;
      totalTravel += estimated;
    }
    return { ...group, stops: sortedStops.slice(0, settings.routeOptimization.maxStopsPerRun), totalEstimatedTravelMins: totalTravel };
  });
  return routes.sort((a, b) => a.cleanerName.localeCompare(b.cleanerName));
}

function mixedFixture(): unknown[] {
  const rows: unknown[] = [];
  const suburbs = ["Surry Hills", "Bondi", "bondi", "Coogee", "Bondi", "Darlinghurst"];
  for (let index = 0; index < 15; index += 1) {
    const a = assignment(index + 1, index % 5 === 0 ? (null as unknown as string) : `${String(6 + ((index * 7) % 12)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`, suburbs[index % suburbs.length]);
    rows.push(a);
  }
  rows.push({ ...assignment(40, "09:00", "Glebe"), userId: "c-tom", user: { id: "c-tom", name: null, email: "tom@x" } });
  rows.push({ ...assignment(41, "08:00", "Glebe"), userId: "c-tom", user: { id: "c-tom", name: null, email: "tom@x" } });
  return rows;
}

afterEach(() => vi.restoreAllMocks());

describe("buildDailyRoutePlan (the Scheduling rules, unchanged)", () => {
  it.each([true, false])("returns exactly what origin/main returns with group by suburb %s", async (groupBySuburb) => {
    const settings = await import("@/lib/settings");
    const current = { ...settings.DEFAULT_SETTINGS, routeOptimization: { ...settings.DEFAULT_SETTINGS.routeOptimization, groupBySuburb } };
    vi.spyOn(settings, "getAppSettings").mockResolvedValue(current);
    m.routeAssignments = mixedFixture();
    const expected = originRoutePlan(m.routeAssignments as OriginRow[], current);
    expect(await buildDailyRoutePlan("2026-11-15")).toEqual(expected);
    // 15 stops on the first route: the rule shows 12.
    expect(expected.find((route) => route.cleanerId === "c-maria")?.stops).toHaveLength(12);
  });

  it("the detailed plan reports the stops the rule leaves out instead of dropping them silently", async () => {
    const [route] = await buildDetailedRoutePlan("2026-11-15");
    expect(route.stops).toHaveLength(12);
    expect(route.hiddenStopCount).toBe(2);
    expect(route.stopLimit).toBe(12);
    // Group by suburb is On by default: suburbs A to Z, so "Suburb M" … "Suburb X" are shown and Y, Z are not.
    expect(route.stops[0].suburb).toBe("Suburb M");
    expect(route.stops.map((stop) => stop.suburb)).not.toContain("Suburb Z");
  });
});

describe("loadRouteMapDay", () => {
  it("returns the shown stops, says how many are hidden, with labelled Maps links and a read-only suggestion", async () => {
    const day = await loadRouteMapDay("2026-11-15");
    expect(day.routes[0].stops).toHaveLength(12);
    expect(day.routes[0].hiddenStopCount).toBe(2);
    expect(day.routes[0].mapsLinks.map((link) => link.label)).toEqual(["stops 1–10", "stops 10–12"]);
    expect(day.routes[0].letter).toBe("M");
    expect(day.unassigned).toHaveLength(1);
    const suggestion = day.unassigned[0].suggestion;
    expect(suggestion.state).toBe("picked");
    if (suggestion.state === "picked") {
      expect(suggestion.best.cleanerName).toBe("Sofia Alvarez");
      expect(suggestion.best.qaScore).toBe(91.4);
      expect(suggestion.best.load).toBe(1);
    }
    expect(day.cleaners.map((cleaner) => cleaner.id)).toEqual(["c-maria", "c-sofia"]);
    // Suggestions are read only: nothing was created, updated or deleted.
    expect(m.writes).toEqual([]);
  });

  it("places a property without a saved position at its suburb centre, or nowhere", async () => {
    m.properties = [{ suburb: "Suburb W", latitude: -33.8, longitude: 151.1 }, { suburb: "Suburb W", latitude: -33.9, longitude: 151.3 }];
    const day = await loadRouteMapDay("2026-11-15");
    const stops = day.routes[0].stops;
    const placed = stops.find((stop) => stop.suburb === "Suburb W");
    expect(placed?.position).toEqual({ lat: -33.85, lng: 151.2, precision: "suburb" });
    expect(stops.find((stop) => stop.suburb === "Suburb X")?.position).toEqual({ lat: -33.9, lng: 151.25, precision: "property" });
    expect(stops.find((stop) => stop.suburb === "Suburb U")?.position).toBeNull();
  });

  it("says suggestions are off rather than showing nobody", async () => {
    const settings = await import("@/lib/settings");
    vi.spyOn(settings, "getAppSettings").mockResolvedValue({ ...settings.DEFAULT_SETTINGS, autoAssign: { ...settings.DEFAULT_SETTINGS.autoAssign, enabled: false } });
    const day = await loadRouteMapDay("2026-11-15");
    expect(day.unassigned[0].suggestion).toEqual({ state: "off" });
  });
});

describe("GET /api/admin/jobs/route-map", () => {
  const request = (query: string) => new Request(`http://localhost/api/admin/jobs/route-map${query}`) as never;

  it("checks the live role guard for ADMIN and OPS_MANAGER before reading", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await GET(request("?date=2026-11-15"));
    expect(response.status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });

  it("refuses a bad date and answers the day for a good one", async () => {
    expect((await GET(request("?date=15-11-2026"))).status).toBe(400);
    const response = await GET(request("?date=2026-11-15"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.date).toBe("2026-11-15");
    expect(body.routes[0].stops).toHaveLength(12);
    expect(body.routes[0].hiddenStopCount).toBe(2);
  });

  it("is a Jobs route for operations managers: off blocks it, view allows it", () => {
    expect(opsRequestFeature("/api/admin/jobs/route-map")).toBe("jobs");
    expect(canUseOpsPath({ ...allOpsLevels("manage"), jobs: "off" }, "/api/admin/jobs/route-map", "GET")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("off"), jobs: "read" }, "/api/admin/jobs/route-map", "GET")).toBe(true);
  });
});
