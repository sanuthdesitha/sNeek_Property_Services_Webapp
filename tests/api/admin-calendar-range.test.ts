// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  jobs: vi.fn(),
  users: vi.fn(),
  laundry: vi.fn(),
  availability: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({
  db: { userPayRate: { findMany: async () => [] }, staffLeave: { findMany: async () => [] },  job: { findMany: m.jobs }, user: { findMany: m.users }, laundryTask: { findMany: m.laundry } },
}));
vi.mock("@/lib/accounts/availability", () => ({ listCleanerAvailabilities: m.availability }));

import { GET } from "@/app/api/admin/calendar/route";

const get = (query: string) => GET(new NextRequest(`http://local/api/admin/calendar?${query}`));

type Record_ = Record<string, unknown>;
function jobRecord(overrides: Record_ = {}): Record_ {
  return {
    id: "j1", jobNumber: "J-1", status: "ASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-11T00:00:00.000Z"),
    startTime: "10:00", endTime: null, dueTime: "14:00", estimatedHours: 3, cleanSkipStatus: "NONE", internalNotes: null,
    sameDayCheckin: false, sameDayCheckinTime: null, manuallyRescheduledAt: null, updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    propertyId: "p1", property: { name: "Bondi Studio", address: "1 Beach Rd", suburb: "Bondi", client: { id: "c1", name: "Harbour" } },
    assignments: [{ userId: "u1", isPrimary: true, user: { name: "Jane C.", email: "jane@x", isActive: true } }],
    qaAssignments: [], notes: "private", internalNoteText: "hidden", ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.jobs.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "u1", name: "Jane C.", email: "jane@x" }, { id: "u2", name: "Aiko T.", email: "aiko@x" }]);
  m.laundry.mockResolvedValue([]);
  m.availability.mockResolvedValue([]);
});

describe("GET /api/admin/calendar", () => {
  it("requires ADMIN or OPS_MANAGER and refuses others before reading jobs", async () => {
    await get("start=2026-11-09&end=2026-11-15");
    expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    m.auth.mockRejectedValue(new Error("FORBIDDEN"));
    const refused = await get("start=2026-11-09&end=2026-11-15");
    expect(refused.status).toBe(403);
    m.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await get("start=2026-11-09&end=2026-11-15")).status).toBe(401);
    expect(m.jobs).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["", "missing bounds"],
    ["start=2026-11-09", "missing end"],
    ["start=2026-11-15&end=2026-11-09", "reversed"],
    ["start=2026-11-01&end=2026-12-16", "46 days"],
    ["start=2026-11-09&end=2026-11-15&rows=everyone", "unknown rows"],
    ["start=2026-11-09&end=2026-11-15&status=SOMETHING", "unknown status"],
  ])("refuses %s (%s) with 400 and no read", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(m.jobs).not.toHaveBeenCalled();
  });

  it("reads only the asked-for calendar days as UTC-midnight bounds, unshifted across the DST change", async () => {
    // Sydney daylight saving began on 4 October 2026; the stored day is still UTC midnight.
    m.jobs.mockResolvedValue([jobRecord({ scheduledDate: new Date("2026-10-04T00:00:00.000Z") })]);
    const response = await get("start=2026-09-28&end=2026-10-04");
    expect(response.status).toBe(200);
    const where = m.jobs.mock.calls[0][0].where;
    expect(where.scheduledDate).toEqual({ gte: new Date("2026-09-28T00:00:00.000Z"), lt: new Date("2026-10-05T00:00:00.000Z") });
    const body = await response.json();
    expect(body.jobs[0].day).toBe("2026-10-04");
    expect(body.range.days).toHaveLength(7);
  });

  it("returns the slim shape without notes, and excludes drafts from jobs and counts", async () => {
    m.jobs.mockResolvedValue([
      jobRecord(),
      jobRecord({ id: "draft", internalNotes: JSON.stringify({ version: 1, isDraft: true }) }),
      jobRecord({ id: "open", assignments: [], status: "UNASSIGNED" }),
    ]);
    const body = await (await get("start=2026-11-09&end=2026-11-15")).json();
    expect(body.jobs.map((job: { id: string }) => job.id)).toEqual(["j1", "open"]);
    expect(Object.keys(body.jobs[0]).sort()).toEqual([
      "cleaners", "clientId", "clientName", "day", "dueTime", "endTime", "estimatedHours", "guestArrival", "hours", "id", "jobNumber",
      "jobType", "late", "moveBlock", "propertyId", "propertyMissingName", "propertyName", "qa", "skipped", "startTime", "status", "suburb", "updatedAt",
    ]);
    expect(body.summary).toMatchObject({ jobs: 2, withoutCleaner: 1, skipped: 0 });
    expect(body.hoursBasis).toMatch(/estimated hours/);
  });

  it("gives every active cleaner a row with hours this range, plus inactive cleaners only when they have work", async () => {
    m.jobs.mockResolvedValue([
      jobRecord({ estimatedHours: 3 }),
      jobRecord({ id: "j2", estimatedHours: null, startTime: "09:00", dueTime: "11:30" }),
      jobRecord({ id: "j3", estimatedHours: null, startTime: null, dueTime: null, assignments: [{ userId: "gone", isPrimary: true, user: { name: "Old Hand", email: null, isActive: false } }] }),
    ]);
    m.availability.mockResolvedValue([{ userId: "u2", mode: "FIXED", weekly: { "1": [{ start: "08:00", end: "16:00" }] }, dateOverrides: {}, notes: null, updatedAt: "" }]);
    const body = await (await get("start=2026-11-09&end=2026-11-15")).json();
    const rows = Object.fromEntries(body.cleanerRows.map((row: { label: string }) => [row.label, row]));
    expect(rows["Jane C."]).toMatchObject({ hours: 5.5, jobsWithoutHours: 0, active: true });
    expect(rows["Aiko T."]).toMatchObject({ hours: 0, active: true });
    // Rostered Mondays only: every other day of the week is "not rostered".
    expect(Object.keys(rows["Aiko T."].unavailable)).toHaveLength(6);
    expect(rows["Aiko T."].unavailable["2026-11-10"]).toBe("Not available on Tuesdays");
    expect(rows["Old Hand"]).toMatchObject({ active: false, jobsWithoutHours: 1 });
    expect(body.propertyRows).toEqual([]);
  });

  it("builds property rows when asked and keeps hours on the whole workload when a filter is on", async () => {
    m.jobs.mockResolvedValue([
      jobRecord({ estimatedHours: 2 }),
      jobRecord({ id: "j2", status: "COMPLETED", estimatedHours: 1, propertyId: "p2", property: { name: "Coogee", address: null, suburb: null, client: { id: "c2", name: "Other" } } }),
    ]);
    const body = await (await get("start=2026-11-09&end=2026-11-15&rows=properties&status=ASSIGNED")).json();
    expect(body.jobs.map((job: { id: string }) => job.id)).toEqual(["j1"]);
    expect(body.propertyRows.map((row: { label: string }) => row.label)).toEqual(["Bondi Studio"]);
    expect(body.cleanerRows.find((row: { label: string }) => row.label === "Jane C.").hours).toBe(3);
    expect(body.summary.statusCounts).toEqual({ ASSIGNED: 1, COMPLETED: 1 });
  });

  it("filters by client and by no cleaner", async () => {
    m.jobs.mockResolvedValue([jobRecord(), jobRecord({ id: "j2", assignments: [], property: { name: "Coogee", address: null, suburb: null, client: { id: "c2", name: "Other" } } })]);
    expect((await (await get("start=2026-11-09&end=2026-11-15&clientId=c2")).json()).jobs.map((job: { id: string }) => job.id)).toEqual(["j2"]);
    expect((await (await get("start=2026-11-09&end=2026-11-15&unassigned=1")).json()).jobs.map((job: { id: string }) => job.id)).toEqual(["j2"]);
  });

  it("counts laundry pickups and drops per calendar day only when asked", async () => {
    m.laundry.mockResolvedValue([
      { id: "l1", pickupDate: new Date("2026-11-09T00:00:00.000Z"), dropoffDate: new Date("2026-11-11T00:00:00.000Z"), noPickupRequired: false, status: "CONFIRMED", property: { name: "Bondi Studio" } },
      { id: "l2", pickupDate: new Date("2026-11-09T00:00:00.000Z"), dropoffDate: new Date("2026-11-20T00:00:00.000Z"), noPickupRequired: true, status: "CONFIRMED", property: { name: "Coogee" } },
    ]);
    const without = await (await get("start=2026-11-09&end=2026-11-15")).json();
    expect(without.laundry).toBeNull();
    expect(m.laundry).not.toHaveBeenCalled();
    const body = await (await get("start=2026-11-09&end=2026-11-15&laundry=1")).json();
    expect(body.laundry["2026-11-09"]).toMatchObject({ pickups: 1, drops: 0 });
    expect(body.laundry["2026-11-11"]).toMatchObject({ pickups: 0, drops: 1 });
  });

  it("marks non-movable and late jobs and shows a same-day guest arrival", async () => {
    m.jobs.mockResolvedValue([
      jobRecord({ status: "IN_PROGRESS" }),
      jobRecord({ id: "g", internalNotes: JSON.stringify({ version: 1, reservationContext: { checkinAtLocal: "2026-11-11T04:00:00.000Z" } }) }),
    ]);
    const body = await (await get("start=2026-11-09&end=2026-11-15")).json();
    expect(body.jobs[0].moveBlock).toMatch(/Work on this job has started/);
    expect(body.jobs[1]).toMatchObject({ moveBlock: null, guestArrival: { time: "15:00" } });
  });
});
