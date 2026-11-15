// @vitest-environment node
/**
 * Route map day (board "Route map", 2026-11-17): every stop is kept above the
 * stops-per-route setting (the 13th used to vanish), routes are ordered by
 * start time, and the "Nobody on these jobs" suggestions come from the
 * existing scorer WITHOUT writing anything. The API keeps today's rights:
 * ADMIN and OPS_MANAGER, and the Jobs pack for managers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
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

describe("buildDailyRoutePlan", () => {
  it("keeps every one of 14 stops, in start-time order, and passes the notice limit back", async () => {
    const [route] = await buildDailyRoutePlan("2026-11-15");
    expect(route.stops).toHaveLength(14);
    expect(route.stopNoticeAbove).toBe(12);
    expect(route.stops.map((stop) => stop.startTime)).toEqual(Array.from({ length: 14 }, (_, index) => `${String(7 + index).padStart(2, "0")}:00`));
    expect(route.totalEstimatedTravelMins).toBe(13 * 22);
  });
});

describe("loadRouteMapDay", () => {
  it("returns every stop with consecutive Maps links and a read-only suggestion", async () => {
    const day = await loadRouteMapDay("2026-11-15");
    expect(day.routes[0].stops).toHaveLength(14);
    expect(day.routes[0].mapsLinks.map((link) => link.label)).toEqual(["stops 1–10", "stops 10–14"]);
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
    m.properties = [{ suburb: "Suburb Y", latitude: -33.8, longitude: 151.1 }, { suburb: "Suburb Y", latitude: -33.9, longitude: 151.3 }];
    const day = await loadRouteMapDay("2026-11-15");
    const stops = day.routes[0].stops;
    const placed = stops.find((stop) => stop.suburb === "Suburb Y");
    expect(placed?.position).toEqual({ lat: -33.85, lng: 151.2, precision: "suburb" });
    expect(stops.find((stop) => stop.suburb === "Suburb X")?.position).toEqual({ lat: -33.9, lng: 151.25, precision: "property" });
    expect(stops.find((stop) => stop.suburb === "Suburb W")?.position).toBeNull();
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
    expect(body.routes[0].stops).toHaveLength(14);
  });

  it("is a Jobs route for operations managers: off blocks it, view allows it", () => {
    expect(opsRequestFeature("/api/admin/jobs/route-map")).toBe("jobs");
    expect(canUseOpsPath({ ...allOpsLevels("manage"), jobs: "off" }, "/api/admin/jobs/route-map", "GET")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("off"), jobs: "read" }, "/api/admin/jobs/route-map", "GET")).toBe(true);
  });
});
