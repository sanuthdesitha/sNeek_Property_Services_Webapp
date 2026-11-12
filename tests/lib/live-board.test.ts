import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ jobs: vi.fn(), pings: vi.fn(), routes: vi.fn(), continuations: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { findMany: m.jobs },
    cleanerLocationPing: { findMany: m.pings },
    laundryRoute: { findMany: m.routes },
    user: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: m.continuations }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/jobs/progress", () => ({ computeChecklistProgressPercent: vi.fn(async () => 40) }));

import { loadLiveBoard } from "@/lib/ops/live-board";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

// 12:00 Sydney on 11 Nov 2026.
const NOW = new Date("2026-11-11T01:00:00Z");

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, jobNumber: id, jobType: "AIRBNB_TURNOVER", propertyId: "p", formTemplateId: null, status: "EN_ROUTE", startTime: "10:00", dueTime: null,
    estimatedHours: 3, sameDayCheckinTime: null, arrivedAt: null, departedAt: null, enRouteEtaMinutes: null, enRouteEtaUpdatedAt: null,
    internalNotes: null, cleanSkipStatus: "NONE", requiresSafetyCheckin: false, safetyCheckinAt: null, gpsDistanceMeters: null, gpsCheckInAt: null,
    property: { name: `Property ${id}`, suburb: null, address: null, latitude: null, longitude: null },
    assignments: [{ user: { id: `u-${id}`, name: `Cleaner ${id}`, email: "c@x", phone: "0400 000 000" } }],
    timeLogs: [],
    ...overrides,
  };
}

beforeEach(() => {
  m.pings.mockReset().mockResolvedValue([]);
  m.routes.mockReset().mockResolvedValue([]);
  m.continuations.mockReset().mockResolvedValue([]);
});

describe("loadLiveBoard", () => {
  it("counts every late job, not a capped list of eight", async () => {
    m.jobs.mockResolvedValue(Array.from({ length: 12 }, (_, i) => job(`j${i}`)));
    const board = await loadLiveBoard({ now: NOW, withProgress: false });
    expect(board.jobs.filter((row) => row.state === "late")).toHaveLength(12);
    expect(board.counts.exceptions).toBe(12);
    expect(board.counts.cleanersOnShift).toBe(12);
  });

  it("counts states for the chips and adds continuation requests to the exceptions", async () => {
    m.jobs.mockResolvedValue([
      job("late"),
      job("onsite", { status: "IN_PROGRESS", arrivedAt: new Date("2026-11-11T00:00:00Z"), timeLogs: [{ id: "t1", userId: "u-onsite", startedAt: new Date("2026-11-11T00:00:00Z") }] }),
      job("planned", { status: "ASSIGNED", startTime: "15:00" }),
      job("ns", { status: "ASSIGNED", startTime: "09:00" }),
      job("done", { status: "COMPLETED" }),
      job("draft", { internalNotes: serializeJobInternalNotes({ isDraft: true }) }),
    ]);
    m.continuations.mockResolvedValue([{ id: "c1", jobId: "onsite", requestedByUserId: "u", reason: "oven", estimatedRemainingHours: 2, requestedAt: "x" }]);
    const board = await loadLiveBoard({ now: NOW });
    expect(board.counts).toMatchObject({ exceptions: 3, onSite: 1, travelling: 0, notStarted: 2 });
    const onsite = board.jobs.find((row) => row.jobId === "onsite");
    expect(onsite).toMatchObject({ elapsedMinutes: 60, allocatedMinutes: 180, progress: { percent: 40, basis: "checklist" }, openTimeLogId: "t1" });
  });

  it("reads today as the Sydney calendar day, also across the UTC date line", async () => {
    m.jobs.mockResolvedValue([]);
    await loadLiveBoard({ now: new Date("2026-11-10T14:30:00Z") });
    const range = m.jobs.mock.calls.at(-1)?.[0].where.scheduledDate;
    expect(range.gte.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("reports laundry driver route progress from the active route's stops", async () => {
    m.jobs.mockResolvedValue([]);
    m.routes.mockResolvedValue([{ id: "r1", userId: "d1", stops: [
      { taskId: "a", kind: "PICKUP", order: 1, propertyId: "p", completedAt: "2026-11-11T00:00:00Z" },
      { taskId: "b", kind: "DROP", order: 2, propertyId: "p", completedAt: "2026-11-11T00:10:00Z" },
      { taskId: "c", kind: "PICKUP", order: 3, propertyId: "p" },
      { taskId: "d", kind: "DROP", order: 4, propertyId: "p" },
    ], user: { name: "Tom", email: "t@x", phone: null } }]);
    const board = await loadLiveBoard({ now: NOW });
    expect(board.drivers).toEqual([expect.objectContaining({ name: "Tom", stopsDone: 2, stopsTotal: 4 })]);
    expect(board.counts.driversOnShift).toBe(1);
  });
});
